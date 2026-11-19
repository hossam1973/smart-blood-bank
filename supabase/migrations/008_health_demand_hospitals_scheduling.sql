-- =====================================================================
-- 008 — الصحة الشخصية وجاهزية التبرع، الطلب المتوقع 48 ساعة،
--        قاعدة مستشفيات مصر (حقول + استيراد)، والمساعد الذكي للجدولة
-- =====================================================================

-- ---------- 1) المؤشرات الحيوية (بيانات صحية حساسة: يراها صاحبها فقط) ----------
create table if not exists donor_vitals (
  id           bigserial primary key,
  donor_id     uuid not null references profiles(id) on delete cascade,
  measured_at  timestamptz not null default now(),
  systolic     int check (systolic between 60 and 260),
  diastolic    int check (diastolic between 30 and 160),
  hemoglobin   numeric(4,1) check (hemoglobin between 4 and 25),   -- g/dL
  pulse        int check (pulse between 30 and 220),
  weight_kg    numeric(5,1) check (weight_kg between 20 and 300),
  water_ml     int check (water_ml between 0 and 10000),           -- خلال آخر 24 ساعة
  sleep_hours  numeric(3,1) check (sleep_hours between 0 and 24),
  source       text not null default 'manual' check (source in ('manual','apple_health','health_connect','clinic'))
);
create index if not exists donor_vitals_donor_idx on donor_vitals(donor_id, measured_at desc);
alter table donor_vitals enable row level security;
create policy "vitals own" on donor_vitals for all using (donor_id = auth.uid()) with check (donor_id = auth.uid());

-- تقييم الجاهزية من آخر قياس (أداة مساعدة — الفحص الطبي في بنك الدم هو الحَكَم)
-- الحدود: ضغط انقباضي 90–160، انبساطي 60–100، نبض 50–100، وزن ≥ 50،
-- هيموجلوبين ≥ 13.0 للرجال و≥ 12.5 للنساء، مع فترة التبرع.
create or replace function readiness_for(p_donor uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare p profiles; v donor_vitals; hb_min numeric; blockers text[] := '{}'; cautions text[] := '{}'; score int := 100; st text;
begin
  select * into p from profiles where id = p_donor;
  if p.id is null then return null; end if;
  select * into v from donor_vitals where donor_id = p_donor order by measured_at desc, id desc limit 1;
  hb_min := case when p.sex = 'female' then 12.5 else 13.0 end;

  if not (p.last_donation_at is null or p.last_donation_at <= current_date - case when p.sex = 'female' then 112 else 84 end) then
    blockers := array_append(blockers, 'interval'); end if;
  if v.id is null then
    return jsonb_build_object('status', case when cardinality(blockers) > 0 then 'defer' else 'unknown' end,
      'score', null, 'blockers', blockers, 'cautions', array['no_vitals'], 'measured_at', null, 'hb_min', hb_min);
  end if;
  if v.hemoglobin is not null and v.hemoglobin < hb_min then blockers := array_append(blockers, 'low_hb'); end if;
  if v.systolic is not null and (v.systolic < 90 or v.systolic > 160) then blockers := array_append(blockers, 'bp_systolic'); end if;
  if v.diastolic is not null and (v.diastolic < 60 or v.diastolic > 100) then blockers := array_append(blockers, 'bp_diastolic'); end if;
  if v.pulse is not null and (v.pulse < 50 or v.pulse > 100) then blockers := array_append(blockers, 'pulse'); end if;
  if coalesce(v.weight_kg, p.weight_kg) is not null and coalesce(v.weight_kg, p.weight_kg) < 50 then blockers := array_append(blockers, 'weight'); end if;
  if v.water_ml is not null and v.water_ml < 1500 then cautions := array_append(cautions, 'hydration'); end if;
  if v.sleep_hours is not null and v.sleep_hours < 6 then cautions := array_append(cautions, 'sleep'); end if;
  if v.hemoglobin is not null and v.hemoglobin >= hb_min and v.hemoglobin < hb_min + 0.5 then cautions := array_append(cautions, 'borderline_hb'); end if;
  if v.measured_at < now() - interval '14 days' then cautions := array_append(cautions, 'stale_vitals'); end if;

  score := greatest(0, 100 - cardinality(blockers) * 35 - cardinality(cautions) * 10);
  st := case when cardinality(blockers) > 0 then 'defer' when cardinality(cautions) > 0 then 'conditional' else 'ready' end;
  return jsonb_build_object('status', st, 'score', score, 'blockers', blockers, 'cautions', cautions,
    'measured_at', v.measured_at, 'hb_min', hb_min,
    'vitals', jsonb_build_object('systolic', v.systolic, 'diastolic', v.diastolic, 'hemoglobin', v.hemoglobin, 'pulse', v.pulse,
      'weight_kg', coalesce(v.weight_kg, p.weight_kg), 'water_ml', v.water_ml, 'sleep_hours', v.sleep_hours, 'source', v.source));
end $$;

create or replace function my_readiness() returns jsonb language sql stable security definer set search_path = public, extensions
  as $$ select readiness_for(auth.uid()) $$;

-- ---------- 2) الطلب المتوقع خلال 48 ساعة ----------
-- لكل فصيلة: متوسط الصرف في نفس (يوم الأسبوع، الساعة) خلال آخر 4 أسابيع، مجموعًا على الـ48 ساعة القادمة،
-- مع الطلبات المفتوحة الحالية، ومقارنته بالرصيد.
create or replace function demand_forecast_48h(p_facility uuid default null)
returns table(blood_type blood_type, expected_units numeric, open_request_units int, stock int, shortfall numeric, peak_hour timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  with fid as (select coalesce(p_facility, my_facility()) as id),
  ok as (select 1 from fid where id is not null and (id = my_facility() or my_role() = 'admin')),
  hist as (
    select m.blood_type, extract(dow from m.created_at)::int dow, extract(hour from m.created_at)::int hr, sum(m.units)::numeric / 4 as avg_units
    from inventory_movements m, fid
    where m.facility_id = fid.id and m.kind in ('issue','transfer_out') and m.created_at >= now() - interval '28 days'
    group by 1, 2, 3),
  slots as (select date_trunc('hour', now()) + make_interval(hours => g) as at from generate_series(1, 48) g),
  per_slot as (
    select t.bt, s.at, coalesce(h.avg_units, 0) as u
    from (select unnest(enum_range(null::blood_type)) bt) t cross join slots s
    left join hist h on h.blood_type = t.bt and h.dow = extract(dow from s.at)::int and h.hr = extract(hour from s.at)::int),
  agg as (
    select bt, round(sum(u), 1) exp_units,
      (array_agg(at order by u desc, at))[1] as peak
    from per_slot group by bt),
  reqs as (
    select r.blood_type, sum(r.units_needed - r.units_secured)::int n from blood_requests r, fid
    where r.facility_id = fid.id and r.status in ('open','matching','partially_fulfilled') group by 1),
  st as (
    select i.blood_type, sum(i.units)::int n from inventory i, fid
    where i.facility_id = fid.id and i.component = 'rbc' and i.expires_at >= current_date group by 1)
  select a.bt, a.exp_units, coalesce(r.n, 0), coalesce(st.n, 0),
         greatest(0, round(a.exp_units + coalesce(r.n, 0) - coalesce(st.n, 0), 1)),
         case when a.exp_units > 0 then a.peak end
  from agg a left join reqs r on r.blood_type = a.bt left join st on st.blood_type = a.bt
  where exists (select 1 from ok)
  order by 5 desc, 2 desc
$$;

-- ---------- 3) قاعدة مستشفيات مصر ----------
alter table facilities add column if not exists governorate text;
alter table facilities add column if not exists sector text check (sector in ('university','moh','uhi','military','police','charity','private','other'));
alter table facilities add column if not exists has_blood_bank boolean not null default false;
alter table facilities add column if not exists open_24h boolean not null default false;
alter table facilities add column if not exists beds int check (beds >= 0);
alter table facilities add column if not exists icu_beds int check (icu_beds >= 0);
alter table facilities add column if not exists trauma_level int check (trauma_level between 1 and 3);
alter table facilities add column if not exists emergency_phone text;
alter table facilities add column if not exists source_url text;           -- مصدر البيانات الرسمي
alter table facilities add column if not exists source_checked_at date;    -- تاريخ التحقق من المصدر
create index if not exists facilities_gov_idx on facilities(governorate);

-- استيراد دفعة من السجلات (المدير فقط). كل سجل مستورد يبدأ "غير موثّق" حتى يُراجع مصدره.
create or replace function admin_import_facilities(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; ok int := 0; bad jsonb := '[]'; i int := 0;
begin
  if my_role() is distinct from 'admin' then raise exception 'admin only'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'expected an array of up to 2000 rows'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      if coalesce(trim(r->>'name'), '') = '' or (r->>'lat') is null or (r->>'lng') is null then raise exception 'name, lat, lng required'; end if;
      if (r->>'lat')::float8 not between 21.5 and 31.8 or (r->>'lng')::float8 not between 24.6 and 37 then raise exception 'coordinates outside Egypt'; end if;
      insert into facilities(name, kind, verified, location, phone, emergency_phone, address, governorate, sector, has_blood_bank, open_24h,
                             beds, icu_beds, trauma_level, license_no, source_url, source_checked_at, accepts_donations)
      values (trim(r->>'name'), coalesce(nullif(r->>'kind',''), 'hospital')::facility_kind, false,
              st_setsrid(st_makepoint((r->>'lng')::float8, (r->>'lat')::float8), 4326)::geography,
              nullif(r->>'phone',''), nullif(r->>'emergency_phone',''), nullif(r->>'address',''), nullif(r->>'governorate',''),
              nullif(r->>'sector',''), coalesce((r->>'has_blood_bank')::boolean, false), coalesce((r->>'open_24h')::boolean, false),
              nullif(r->>'beds','')::int, nullif(r->>'icu_beds','')::int, nullif(r->>'trauma_level','')::int,
              nullif(r->>'license_no',''), nullif(r->>'source_url',''), nullif(r->>'source_checked_at','')::date,
              coalesce((r->>'has_blood_bank')::boolean, false));
      ok := ok + 1;
    exception when others then
      bad := bad || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;
  insert into audit_log(actor, action, target_type, target_id, details)
  values (auth.uid(), 'import', 'facilities', null, jsonb_build_object('imported', ok, 'failed', jsonb_array_length(bad)));
  return jsonb_build_object('imported', ok, 'failed', bad);
end $$;

-- ---------- 4) المساعد الذكي للجدولة ----------
-- يقترح أفضل موعد ومكان: بعد موعد الأهلية، وحسب احتياج الأماكن القريبة لفصيلته
-- (طلبات مفتوحة + مخزون تحت الحد الآمن + طلب متوقع)، والمسافة، والسعة المتاحة، وجاهزيته الصحية.
create or replace function suggest_donation_slots(lat float8, lng float8, radius_km int default 30)
returns table(facility_id uuid, name text, distance_km numeric, suggested_day date, suggested_hour int, score int, reasons text[], f_lat float8, f_lng float8)
language plpgsql stable security definer set search_path = public, extensions as $$
declare me profiles; first_day date; rd jsonb; extra int := 0;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.role <> 'donor' or me.blood_type is null then return; end if;
  first_day := greatest(current_date + 1, coalesce(me.last_donation_at + case when me.sex = 'female' then 112 else 84 end, current_date + 1));
  rd := readiness_for(me.id);
  if rd->'blockers' ? 'low_hb' then extra := 14; end if;            -- إعطاء وقت لرفع الحديد
  if rd->'cautions' ? 'borderline_hb' then extra := greatest(extra, 3); end if;
  first_day := first_day + extra;

  return query
  with sites as (
    select f.id, f.name, f.location, f.daily_slots,
           round((st_distance(f.location, st_makepoint(lng, lat)::geography) / 1000)::numeric, 1) as km
    from facilities f
    where f.verified and not f.suspended and f.accepts_donations
      and st_dwithin(f.location, st_makepoint(lng, lat)::geography, radius_km * 1000)),
  need as (
    select s.id,
      coalesce((select sum(r.units_needed - r.units_secured) from blood_requests r
                where r.facility_id = s.id and r.status in ('open','matching','partially_fulfilled') and r.verified_by_facility
                  and me.blood_type = any(compatible_donor_types(r.blood_type))), 0)::int as open_units,
      coalesce((select sum(i.units) from inventory i where i.facility_id = s.id and i.blood_type = me.blood_type
                and i.component = 'rbc' and i.expires_at >= current_date), 0)::int as stock,
      coalesce((select ss.min_units from safety_stock ss where ss.facility_id = s.id and ss.blood_type = me.blood_type and ss.component = 'rbc'), 5) as safety
    from sites s),
  days as (select (first_day + g)::date d from generate_series(0, 6) g),
  cap as (
    select s.id, d.d, s.daily_slots - (select count(*) from appointments a where a.facility_id = s.id and a.status = 'booked' and a.slot_at::date = d.d) as free
    from sites s cross join days d),
  best as (
    select distinct on (c.id) c.id, c.d from cap c where c.free > 0 order by c.id, c.d)
  select s.id, s.name, s.km, b.d,
    case when extract(dow from b.d) = 5 then 16 else 11 end,      -- الجمعة: مساءً، غير ذلك صباحًا
    (least(n.open_units, 5) * 12 + case when n.stock < n.safety then 25 else 0 end
      + greatest(0, 30 - (s.km * 2)::int) - (b.d - first_day) * 2)::int,
    array_remove(array[
      case when n.open_units > 0 then 'open_requests' end,
      case when n.stock < n.safety then 'low_stock' end,
      case when s.km <= 5 then 'nearby' end,
      case when b.d = first_day then 'earliest' end,
      case when extra > 0 then 'iron_recovery' end], null),
    st_y(s.location::geometry), st_x(s.location::geometry)
  from sites s join need n on n.id = s.id join best b on b.id = s.id
  order by 6 desc, s.km
  limit 5;
end $$;

-- ---------- الصلاحيات ----------
do $$
declare f text;
begin
  foreach f in array array['my_readiness()', 'demand_forecast_48h(uuid)', 'admin_import_facilities(jsonb)',
                           'suggest_donation_slots(float8, float8, int)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function readiness_for(uuid) from public, anon, authenticated;  -- داخلية فقط
