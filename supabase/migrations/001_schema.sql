-- =====================================================================
-- Smart Blood Bank — قاعدة البيانات (Supabase / PostgreSQL + PostGIS)
-- =====================================================================
create extension if not exists postgis with schema extensions;

create type user_role      as enum ('donor','beneficiary','facility_staff','admin');
create type blood_type     as enum ('O-','O+','A-','A+','B-','B+','AB-','AB+');
create type blood_component as enum ('whole','rbc','plasma','platelets');
create type facility_kind  as enum ('hospital','blood_bank','medical_center','lab');
create type urgency_level  as enum ('routine','urgent','critical');
create type request_status as enum ('open','matching','partially_fulfilled','fulfilled','cancelled','expired');
create type plan_tier      as enum ('free','pro','enterprise');

-- ---------------------------------------------------------------------
-- المنشآت (مستشفيات / بنوك دم / مراكز طبية) — لكل منشأة بوابة خاصة
-- ---------------------------------------------------------------------
create table facilities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          facility_kind not null,
  license_no    text unique,
  verified      boolean not null default false,       -- توثيق يدوي من الإدارة
  phone         text,
  address       text,
  location      geography(Point,4326) not null,
  plan          plan_tier not null default 'free',     -- مصدر إيراد: اشتراك SaaS
  plan_renews_at timestamptz,
  created_at    timestamptz not null default now()
);
create index facilities_loc_idx on facilities using gist(location);

-- ---------------------------------------------------------------------
-- الملفات الشخصية (متبرع / مستفيد / موظف منشأة / إدارة)
-- ---------------------------------------------------------------------
create table profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  role             user_role not null,
  full_name        text not null,
  phone            text,
  blood_type       blood_type,
  birth_date       date,
  weight_kg        numeric(5,1),
  sex              text check (sex in ('male','female')),
  facility_id      uuid references facilities(id),       -- لموظفي المنشآت
  -- الموقع الدقيق لا يُعرض لأي مستخدم آخر (خصوصية) — يُستخدم للحساب فقط
  location         geography(Point,4326),
  available        boolean not null default true,         -- المتبرع متاح لاستقبال النداءات
  last_donation_at date,
  push_token       text,
  created_at       timestamptz not null default now()
);
create index profiles_loc_idx on profiles using gist(location);
create index profiles_bt_idx  on profiles(blood_type) where role = 'donor';

-- ---------------------------------------------------------------------
-- مخزون الدم لكل منشأة
-- ---------------------------------------------------------------------
create table inventory (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references facilities(id) on delete cascade,
  blood_type   blood_type not null,
  component    blood_component not null default 'rbc',
  units        int not null check (units >= 0),
  expires_at   date not null,
  updated_at   timestamptz not null default now(),
  unique (facility_id, blood_type, component, expires_at)
);

-- ---------------------------------------------------------------------
-- طلبات الدم (من مستفيد أو من منشأة)
-- ---------------------------------------------------------------------
create table blood_requests (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references profiles(id),
  facility_id    uuid not null references facilities(id),  -- مكان استلام/التبرع
  patient_label  text,                                      -- بدون بيانات تعريفية حساسة
  blood_type     blood_type not null,
  component      blood_component not null default 'rbc',
  units_needed   int not null check (units_needed between 1 and 20),
  units_secured  int not null default 0,
  urgency        urgency_level not null default 'urgent',
  status         request_status not null default 'open',
  needed_by      timestamptz,
  verified_by_facility boolean not null default false,      -- يمنع الطلبات الوهمية
  created_at     timestamptz not null default now()
);

-- ردود المتبرعين على الطلبات
create table donor_responses (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references blood_requests(id) on delete cascade,
  donor_id     uuid not null references profiles(id),
  status       text not null default 'accepted'
               check (status in ('accepted','arrived','donated','no_show','declined')),
  eta_minutes  int,
  created_at   timestamptz not null default now(),
  unique (request_id, donor_id)
);

-- مواعيد التبرع المجدولة
create table appointments (
  id           uuid primary key default gen_random_uuid(),
  donor_id     uuid not null references profiles(id),
  facility_id  uuid not null references facilities(id),
  slot_at      timestamptz not null,
  status       text not null default 'booked' check (status in ('booked','done','missed','cancelled')),
  created_at   timestamptz not null default now()
);

-- سجل محادثات الوكيل الذكي (للتدقيق وتحسين الجودة)
create table agent_logs (
  id         bigserial primary key,
  user_id    uuid references profiles(id),
  role       user_role,
  question   text,
  tools_used text[],
  created_at timestamptz not null default now()
);

-- =====================================================================
-- دوال المنطق الأساسي
-- =====================================================================

-- فصائل المتبرعين المتوافقة مع فصيلة المريض (كريات حمراء)
create or replace function compatible_donor_types(recipient blood_type)
returns blood_type[] language sql immutable set search_path = public, extensions as $$
  select case recipient
    when 'O-'  then array['O-']::blood_type[]
    when 'O+'  then array['O+','O-']::blood_type[]
    when 'A-'  then array['A-','O-']::blood_type[]
    when 'A+'  then array['A+','A-','O+','O-']::blood_type[]
    when 'B-'  then array['B-','O-']::blood_type[]
    when 'B+'  then array['B+','B-','O+','O-']::blood_type[]
    when 'AB-' then array['AB-','A-','B-','O-']::blood_type[]
    when 'AB+' then array['O-','O+','A-','A+','B-','B+','AB-','AB+']::blood_type[]
  end
$$;

-- أهلية المتبرع (قواعد مبسطة — تُضبط حسب لوائح وزارة الصحة المحلية)
create or replace function donor_is_eligible(p profiles)
returns boolean language sql stable set search_path = public, extensions as $$
  select p.available
     and p.blood_type is not null
     and (p.weight_kg is null or p.weight_kg >= 50)
     and (p.birth_date is null or age(p.birth_date) between interval '18 years' and interval '65 years')
     and (p.last_donation_at is null
          or p.last_donation_at <= current_date - case when p.sex = 'female' then 112 else 84 end)
$$;

-- أقرب المتبرعين المؤهلين لطلب معين (لا تُرجع إحداثيات — مسافة تقريبية فقط)
create or replace function find_donors_for_request(req_id uuid, radius_km int default 15, max_results int default 50)
returns table(donor_id uuid, blood_type blood_type, distance_km numeric)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.blood_type, round((st_distance(p.location, f.location)/1000)::numeric, 1)
  from blood_requests r
  join facilities f on f.id = r.facility_id
  join profiles  p on p.role = 'donor'
                  and p.blood_type = any(compatible_donor_types(r.blood_type))
                  and st_dwithin(p.location, f.location, radius_km * 1000)
  where r.id = req_id and donor_is_eligible(p)
  order by (p.blood_type = r.blood_type) desc, st_distance(p.location, f.location)
  limit max_results
$$;

-- البحث عن مخزون متوافق قريب من نقطة
create or replace function find_inventory_nearby(
  p_blood_type blood_type, p_component blood_component, lat float8, lng float8, radius_km int default 30)
returns table(facility_id uuid, facility_name text, kind facility_kind, phone text,
              blood_type blood_type, units int, distance_km numeric)
language sql stable security definer set search_path = public, extensions as $$
  select f.id, f.name, f.kind, f.phone, i.blood_type, sum(i.units)::int,
         round((st_distance(f.location, st_makepoint(lng,lat)::geography)/1000)::numeric,1)
  from inventory i join facilities f on f.id = i.facility_id
  where f.verified
    and i.component = p_component
    and i.blood_type = any(compatible_donor_types(p_blood_type))
    and i.expires_at >= current_date and i.units > 0
    and st_dwithin(f.location, st_makepoint(lng,lat)::geography, radius_km*1000)
  group by f.id, f.name, f.kind, f.phone, i.blood_type, f.location
  order by (i.blood_type = p_blood_type) desc, 7
$$;

-- الطلبات المفتوحة القريبة من المتبرع والمتوافقة مع فصيلته
create or replace function open_requests_for_donor(radius_km int default 25)
returns table(request_id uuid, facility_name text, blood_type blood_type, units_left int,
              urgency urgency_level, distance_km numeric, needed_by timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, f.name, r.blood_type, r.units_needed - r.units_secured, r.urgency,
         round((st_distance(p.location, f.location)/1000)::numeric,1), r.needed_by
  from profiles p
  join blood_requests r on r.status in ('open','matching','partially_fulfilled')
                       and p.blood_type = any(compatible_donor_types(r.blood_type))
  join facilities f on f.id = r.facility_id
  where p.id = auth.uid() and st_dwithin(p.location, f.location, radius_km*1000)
  order by r.urgency desc, 6
$$;

-- =====================================================================
-- Row Level Security — كل بوابة ترى ما يخصها فقط
-- =====================================================================
alter table profiles        enable row level security;
alter table facilities      enable row level security;
alter table inventory       enable row level security;
alter table blood_requests  enable row level security;
alter table donor_responses enable row level security;
alter table appointments    enable row level security;
alter table agent_logs      enable row level security;

create or replace function my_role() returns user_role language sql stable security definer set search_path = public, extensions
  as $$ select role from profiles where id = auth.uid() $$;
create or replace function my_facility() returns uuid language sql stable security definer set search_path = public, extensions
  as $$ select facility_id from profiles where id = auth.uid() $$;

create policy "own profile"            on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "admin profiles"         on profiles for select using (my_role() = 'admin');

create policy "facilities public read" on facilities for select using (verified or my_role() = 'admin' or id = my_facility());
create policy "staff edit facility"    on facilities for update using (id = my_facility());

create policy "inventory read"         on inventory for select using (true);   -- الكميات عامة لتسريع الوصول
create policy "staff manage inventory" on inventory for all using (facility_id = my_facility()) with check (facility_id = my_facility());

create policy "requests read"          on blood_requests for select using (
  requester_id = auth.uid() or facility_id = my_facility() or my_role() in ('donor','admin'));
create policy "requests create"        on blood_requests for insert with check (requester_id = auth.uid());
create policy "requests update"        on blood_requests for update using (requester_id = auth.uid() or facility_id = my_facility());

create policy "responses donor"        on donor_responses for all using (donor_id = auth.uid()) with check (donor_id = auth.uid());
create policy "responses facility"     on donor_responses for select using (
  exists (select 1 from blood_requests r where r.id = request_id and (r.facility_id = my_facility() or r.requester_id = auth.uid())));

create policy "appointments donor"     on appointments for all using (donor_id = auth.uid()) with check (donor_id = auth.uid());
create policy "appointments facility"  on appointments for select using (facility_id = my_facility());

create policy "agent logs own"         on agent_logs for insert with check (user_id = auth.uid());

-- =====================================================================
-- حراسة الحقول الحساسة (لا يمكن للمستخدم ترقية نفسه)
-- auth.uid() يكون null عند الاستدعاء بمفتاح الخدمة (لوحة الإدارة/الخادم) فيُسمح بالتعديل
-- =====================================================================
create or replace function guard_profile() returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if auth.uid() is null or my_role() = 'admin' then return new; end if;
  if tg_op = 'INSERT' then
    if new.role = 'admin' then raise exception 'cannot self-assign admin role'; end if;
    new.facility_id := null;              -- الربط بمنشأة يتم من الإدارة بعد التوثيق
  else
    new.role := old.role;
    new.facility_id := old.facility_id;
  end if;
  return new;
end $$;
create trigger trg_guard_profile before insert or update on profiles for each row execute function guard_profile();

create or replace function guard_facility() returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if auth.uid() is null or my_role() = 'admin' then return new; end if;
  new.verified := old.verified;
  new.plan := old.plan;
  new.plan_renews_at := old.plan_renews_at;
  new.license_no := old.license_no;
  return new;
end $$;
create trigger trg_guard_facility before update on facilities for each row execute function guard_facility();

create or replace function guard_request() returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if auth.uid() is null or my_role() = 'admin' then return new; end if;
  if tg_op = 'INSERT' then
    if new.facility_id is distinct from my_facility() then   -- الطلب من مستفيد: يبدأ غير موثق
      new.verified_by_facility := false;
      new.status := 'open';
      new.units_secured := 0;
    end if;
  elsif old.facility_id is distinct from my_facility() then  -- مقدم الطلب يمكنه الإلغاء فقط
    new.verified_by_facility := old.verified_by_facility;
    new.units_secured := old.units_secured;
    new.facility_id := old.facility_id;
    new.blood_type := old.blood_type;
    if new.status <> 'cancelled' then new.status := old.status; end if;
  end if;
  return new;
end $$;
create trigger trg_guard_request before insert or update on blood_requests for each row execute function guard_request();
