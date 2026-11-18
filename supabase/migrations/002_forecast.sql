-- =====================================================================
-- 002 — بيانات محرك التنبؤ: حركات المخزون + الحد الآمن + سجل النداءات
-- =====================================================================

create type movement_kind as enum ('issue','deposit','expired','transfer_in','transfer_out');

-- كل صرف/إيداع يُسجَّل — هذا هو مصدر معدل الصرف ومعدل التعويض اليومي
create table inventory_movements (
  id           bigserial primary key,
  facility_id  uuid not null references facilities(id) on delete cascade,
  blood_type   blood_type not null,
  component    blood_component not null default 'rbc',
  kind         movement_kind not null,
  units        int not null check (units > 0),
  reason       text,                       -- surgery / trauma / obstetric / oncology ...
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index movements_fac_time_idx on inventory_movements(facility_id, created_at desc);

-- الحد الآمن السريري لكل فصيلة في كل منشأة (افتراضي = 3 أيام من متوسط الصرف أو 5 وحدات)
create table safety_stock (
  facility_id  uuid not null references facilities(id) on delete cascade,
  blood_type   blood_type not null,
  component    blood_component not null default 'rbc',
  min_units    int not null check (min_units >= 0),
  primary key (facility_id, blood_type, component)
);

-- سجل نداءات الاستدعاء (للتدقيق ولمنع إزعاج المتبرعين)
create table donor_recalls (
  id            bigserial primary key,
  facility_id   uuid not null references facilities(id),
  blood_types   blood_type[] not null,
  donors_notified int not null default 0,
  triggered_by  uuid references profiles(id),
  created_at    timestamptz not null default now()
);

alter table inventory_movements enable row level security;
alter table safety_stock        enable row level security;
alter table donor_recalls       enable row level security;
create policy "staff movements" on inventory_movements for all using (facility_id = my_facility()) with check (facility_id = my_facility());
create policy "staff safety"    on safety_stock        for all using (facility_id = my_facility()) with check (facility_id = my_facility());
create policy "staff recalls"   on donor_recalls       for select using (facility_id = my_facility());

-- ---------------------------------------------------------------------
-- تسجيل حركة وتحديث الرصيد في عملية واحدة (FEFO: الأقدم صلاحية يُصرف أولًا)
-- ---------------------------------------------------------------------
create or replace function record_movement(
  p_blood_type blood_type, p_kind movement_kind, p_units int,
  p_component blood_component default 'rbc', p_reason text default null,
  p_expires_at date default (current_date + 35))
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  fid uuid := my_facility();
  remaining int := p_units;
  b record;
begin
  if fid is null then raise exception 'not facility staff'; end if;
  if p_units <= 0 then raise exception 'units must be positive'; end if;

  if p_kind in ('deposit','transfer_in') then
    insert into inventory(facility_id, blood_type, component, units, expires_at)
    values (fid, p_blood_type, p_component, p_units, p_expires_at)
    on conflict (facility_id, blood_type, component, expires_at)
    do update set units = inventory.units + excluded.units, updated_at = now();
  else
    for b in select id, units from inventory
             where facility_id = fid and blood_type = p_blood_type and component = p_component
               and units > 0 and (p_kind = 'expired' or expires_at >= current_date)
             order by expires_at for update loop
      exit when remaining = 0;
      update inventory set units = units - least(b.units, remaining), updated_at = now() where id = b.id;
      remaining := remaining - least(b.units, remaining);
    end loop;
    if remaining > 0 then raise exception 'insufficient stock: % units short', remaining; end if;
  end if;

  insert into inventory_movements(facility_id, blood_type, component, kind, units, reason, created_by)
  values (fid, p_blood_type, p_component, p_kind, p_units, p_reason, auth.uid());

  return (select coalesce(sum(units),0) from inventory
          where facility_id = fid and blood_type = p_blood_type and component = p_component and expires_at >= current_date);
end $$;

-- ---------------------------------------------------------------------
-- مدخلات المحرك: الرصيد + الحد الآمن + معدلات آخر 14 يومًا لكل فصيلة
-- ---------------------------------------------------------------------
create or replace function forecast_inputs(p_facility uuid, p_component blood_component default 'rbc', p_window_days int default 14)
returns table(blood_type blood_type, units int, safety_stock int, burn_rate numeric, inflow_rate numeric)
language sql stable security definer set search_path = public, extensions as $$
  with t as (select unnest(enum_range(null::blood_type)) as bt),
  stock as (
    select i.blood_type, sum(i.units)::int u from inventory i
    where i.facility_id = p_facility and i.component = p_component and i.expires_at >= current_date
    group by 1),
  mv as (
    select m.blood_type,
      sum(case when m.kind in ('issue','transfer_out') then m.units else 0 end)::numeric / p_window_days burn,
      sum(case when m.kind in ('deposit','transfer_in') then m.units else 0 end)::numeric / p_window_days inflow
    from inventory_movements m
    where m.facility_id = p_facility and m.component = p_component
      and m.created_at >= now() - make_interval(days => p_window_days)
    group by 1)
  select t.bt, coalesce(stock.u,0),
         coalesce(ss.min_units, greatest(5, ceil(coalesce(mv.burn,0) * 3)::int)),
         round(coalesce(mv.burn,0), 2), round(coalesce(mv.inflow,0), 2)
  from t
  left join stock on stock.blood_type = t.bt
  left join mv    on mv.blood_type = t.bt
  left join safety_stock ss on ss.facility_id = p_facility and ss.blood_type = t.bt and ss.component = p_component
  where p_facility = my_facility() or my_role() = 'admin'
  order by t.bt
$$;

-- ---------------------------------------------------------------------
-- متبرعون مؤهلون من فصائل محددة قرب منشأة (للاستخدام من الخادم فقط — service role)
-- ---------------------------------------------------------------------
create or replace function eligible_donors_near_facility(p_facility uuid, p_types blood_type[], radius_km int default 25)
returns table(donor_id uuid, blood_type blood_type, push_token text, distance_km numeric)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.blood_type, p.push_token, round((st_distance(p.location, f.location)/1000)::numeric,1)
  from facilities f
  join profiles p on p.role = 'donor' and p.blood_type = any(p_types)
                 and st_dwithin(p.location, f.location, radius_km*1000)
  where f.id = p_facility and donor_is_eligible(p)
  order by st_distance(p.location, f.location)
  limit 500
$$;
revoke execute on function eligible_donors_near_facility(uuid, blood_type[], int) from public, anon, authenticated;
