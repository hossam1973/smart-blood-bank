-- =====================================================================
-- 004 — الخرائط والحجز
-- مواقع التبرع وساعات العمل، إحداثيات المنشآت في نتائج البحث (أماكن عامة)،
-- كثافة متبرعين مجمّعة بمناطق ~1.1 كم ولا تُعرض منطقة فيها أقل من 3 متبرعين،
-- وحجز مواعيد التبرع مع منع الحجز المزدوج وتجاوز السعة.
-- =====================================================================
alter table facilities add column if not exists accepts_donations boolean not null default true;
alter table facilities add column if not exists hours text;
alter table facilities add column if not exists daily_slots int not null default 40;

drop function if exists find_inventory_nearby(blood_type, blood_component, float8, float8, int);
create function find_inventory_nearby(
  p_blood_type blood_type, p_component blood_component, lat float8, lng float8, radius_km int default 30)
returns table(facility_id uuid, facility_name text, kind facility_kind, phone text,
              blood_type blood_type, units int, distance_km numeric, f_lat float8, f_lng float8)
language sql stable security definer set search_path = public, extensions as $$
  select f.id, f.name, f.kind, f.phone, i.blood_type, sum(i.units)::int,
         round((st_distance(f.location, st_makepoint(lng,lat)::geography)/1000)::numeric,1),
         st_y(f.location::geometry), st_x(f.location::geometry)
  from inventory i join facilities f on f.id = i.facility_id
  where f.verified and i.component = p_component
    and i.blood_type = any(compatible_donor_types(p_blood_type))
    and i.expires_at >= current_date and i.units > 0
    and st_dwithin(f.location, st_makepoint(lng,lat)::geography, radius_km*1000)
  group by f.id, f.name, f.kind, f.phone, i.blood_type, f.location
  order by (i.blood_type = p_blood_type) desc, 7
$$;

drop function if exists open_requests_for_donor(int);
create function open_requests_for_donor(radius_km int default 25)
returns table(request_id uuid, facility_id uuid, facility_name text, blood_type blood_type, units_left int,
              urgency urgency_level, distance_km numeric, needed_by timestamptz, f_lat float8, f_lng float8)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, f.id, f.name, r.blood_type, r.units_needed - r.units_secured, r.urgency,
         round((st_distance(p.location, f.location)/1000)::numeric,1), r.needed_by,
         st_y(f.location::geometry), st_x(f.location::geometry)
  from profiles p
  join blood_requests r on r.status in ('open','matching','partially_fulfilled') and r.verified_by_facility
                       and p.blood_type = any(compatible_donor_types(r.blood_type))
  join facilities f on f.id = r.facility_id
  where p.id = auth.uid() and st_dwithin(p.location, f.location, radius_km*1000)
  order by r.urgency desc, 7
$$;

create or replace function nearest_donation_sites(lat float8, lng float8, radius_km int default 30)
returns table(facility_id uuid, name text, kind facility_kind, phone text, address text, hours text,
              distance_km numeric, f_lat float8, f_lng float8)
language sql stable security definer set search_path = public, extensions as $$
  select f.id, f.name, f.kind, f.phone, f.address, f.hours,
         round((st_distance(f.location, st_makepoint(lng,lat)::geography)/1000)::numeric,1),
         st_y(f.location::geometry), st_x(f.location::geometry)
  from facilities f
  where f.verified and f.accepts_donations
    and st_dwithin(f.location, st_makepoint(lng,lat)::geography, radius_km*1000)
  order by 7
  limit 30
$$;

create or replace function donor_density_near_my_facility(radius_km int default 20, p_types blood_type[] default null)
returns table(cell_lat float8, cell_lng float8, donors int)
language sql stable security definer set search_path = public, extensions as $$
  select round(st_y(p.location::geometry)::numeric, 2)::float8, round(st_x(p.location::geometry)::numeric, 2)::float8, count(*)::int
  from facilities f
  join profiles p on p.role = 'donor' and donor_is_eligible(p)
                 and (p_types is null or p.blood_type = any(p_types))
                 and st_dwithin(p.location, f.location, radius_km*1000)
  where f.id = my_facility()
  group by 1, 2
  having count(*) >= 3
$$;

create unique index if not exists appointments_one_active_per_donor
  on appointments(donor_id) where status = 'booked';

create or replace function book_donation(p_facility uuid, p_slot timestamptz)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me profiles; cap int; taken int; new_id uuid;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.role <> 'donor' then raise exception 'donors only'; end if;
  if not donor_is_eligible(me) then raise exception 'not eligible yet'; end if;
  if p_slot < now() or p_slot > now() + interval '30 days' then raise exception 'slot out of range'; end if;
  select daily_slots into cap from facilities where id = p_facility and verified and accepts_donations;
  if cap is null then raise exception 'facility not accepting donations'; end if;
  select count(*) into taken from appointments where facility_id = p_facility and status = 'booked'
    and slot_at::date = p_slot::date;
  if taken >= cap then raise exception 'day is full'; end if;
  insert into appointments(donor_id, facility_id, slot_at) values (me.id, p_facility, p_slot) returning id into new_id;
  return new_id;
end $$;

revoke execute on function find_inventory_nearby(blood_type, blood_component, float8, float8, int) from public, anon;
revoke execute on function open_requests_for_donor(int) from public, anon;
revoke execute on function nearest_donation_sites(float8, float8, int) from public, anon;
revoke execute on function donor_density_near_my_facility(int, blood_type[]) from public, anon;
revoke execute on function book_donation(uuid, timestamptz) from public, anon;
grant execute on function find_inventory_nearby(blood_type, blood_component, float8, float8, int) to authenticated;
grant execute on function open_requests_for_donor(int) to authenticated;
grant execute on function nearest_donation_sites(float8, float8, int) to authenticated;
grant execute on function donor_density_near_my_facility(int, blood_type[]) to authenticated;
grant execute on function book_donation(uuid, timestamptz) to authenticated;
