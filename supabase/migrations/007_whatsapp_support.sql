-- 007 — دعم واتساب: جلسات المحادثة ودوال للخادم فقط
create table if not exists wa_sessions (
  phone      text primary key,
  profile_id uuid references profiles(id) on delete cascade,
  messages   jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
alter table wa_sessions enable row level security;

create or replace function profile_point(p_profile uuid)
returns table(lat float8, lng float8)
language sql stable security definer set search_path = public, extensions as $$
  select st_y(location::geometry), st_x(location::geometry) from profiles where id = p_profile and location is not null
$$;

create or replace function open_requests_for_profile(p_profile uuid, radius_km int default 25)
returns table(facility_name text, blood_type blood_type, units_left int, urgency urgency_level, distance_km numeric, f_lat float8, f_lng float8)
language sql stable security definer set search_path = public, extensions as $$
  select f.name, r.blood_type, r.units_needed - r.units_secured, r.urgency,
         round((st_distance(p.location, f.location)/1000)::numeric,1), st_y(f.location::geometry), st_x(f.location::geometry)
  from profiles p
  join blood_requests r on r.status in ('open','matching','partially_fulfilled') and r.verified_by_facility
                       and p.blood_type = any(compatible_donor_types(r.blood_type))
  join facilities f on f.id = r.facility_id and not f.suspended
  where p.id = p_profile and st_dwithin(p.location, f.location, radius_km*1000)
  order by r.urgency desc, 5
  limit 10
$$;

revoke execute on function profile_point(uuid) from public, anon, authenticated;
revoke execute on function open_requests_for_profile(uuid, int) from public, anon, authenticated;
