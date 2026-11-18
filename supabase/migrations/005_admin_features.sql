-- =====================================================================
-- 005 — مدير المنصة والميزات الجديدة
-- إيقاف الحسابات/المنشآت، سجل تدقيق، أسعار الباقات، إحصاءات الإدارة،
-- رحلة الكيس، الأوسمة وبطل الأسبوع، بطاقة QR، حملات الشركات، فرز الطلبات، التقارير اليومية
-- =====================================================================

-- ---------- الإيقاف واللغة ----------
alter table profiles   add column if not exists suspended boolean not null default false;
alter table profiles   add column if not exists lang text not null default 'ar' check (lang in ('ar','en','fr','ur','hi','tr'));
alter table profiles   add column if not exists show_on_leaderboard boolean not null default false;
alter table facilities add column if not exists suspended boolean not null default false;
alter table blood_requests add column if not exists fulfilled_at timestamptz;

-- الحساب أو المنشأة الموقوفة تفقد صلاحياتها تلقائيًا (كل السياسات تعتمد على هاتين الدالتين)
create or replace function my_role() returns user_role language sql stable security definer set search_path = public, extensions
  as $$ select role from profiles where id = auth.uid() and not suspended $$;
create or replace function my_facility() returns uuid language sql stable security definer set search_path = public, extensions
  as $$ select p.facility_id from profiles p join facilities f on f.id = p.facility_id
        where p.id = auth.uid() and not p.suspended and not f.suspended $$;

-- لا يستطيع المستخدم رفع الإيقاف عن نفسه
create or replace function guard_profile() returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if auth.uid() is null or my_role() = 'admin' then return new; end if;
  if tg_op = 'INSERT' then
    if new.role = 'admin' then raise exception 'cannot self-assign admin role'; end if;
    new.facility_id := null;
    new.suspended := false;
  else
    new.role := old.role;
    new.facility_id := old.facility_id;
    new.suspended := old.suspended;
  end if;
  return new;
end $$;

create or replace function guard_facility() returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if auth.uid() is null or my_role() = 'admin' then return new; end if;
  new.verified := old.verified;
  new.plan := old.plan;
  new.plan_renews_at := old.plan_renews_at;
  new.license_no := old.license_no;
  new.suspended := old.suspended;
  return new;
end $$;

-- الطلب يكتمل تلقائيًا عند تأمين كل الوحدات
create or replace function complete_request() returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if new.units_secured >= new.units_needed and new.status not in ('cancelled','fulfilled') then
    new.status := 'fulfilled';
  end if;
  if new.status = 'fulfilled' and new.fulfilled_at is null then new.fulfilled_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_complete_request on blood_requests;
create trigger trg_complete_request before update on blood_requests for each row execute function complete_request();

-- ---------- صلاحيات المدير ----------
drop policy if exists "admin profiles" on profiles;
create policy "admin read profiles"   on profiles   for select using (my_role() = 'admin');
create policy "admin update profiles" on profiles   for update using (my_role() = 'admin') with check (my_role() = 'admin');
create policy "admin manage facilities" on facilities for all using (my_role() = 'admin') with check (my_role() = 'admin');
create policy "admin update requests" on blood_requests for update using (my_role() = 'admin');

-- الموقوف لا يُنشئ طلبات ولا يستجيب لها
drop policy if exists "requests create" on blood_requests;
create policy "requests create" on blood_requests for insert with check (requester_id = auth.uid() and my_role() is not null);
drop policy if exists "responses donor" on donor_responses;
create policy "responses donor" on donor_responses for all using (donor_id = auth.uid()) with check (donor_id = auth.uid() and my_role() = 'donor');

-- ---------- سجل التدقيق ----------
create table if not exists audit_log (
  id          bigserial primary key,
  actor       uuid,
  action      text not null,
  target_type text not null,
  target_id   text,
  details     jsonb not null default '{}',
  at          timestamptz not null default now()
);
create index if not exists audit_log_at_idx on audit_log(at desc);
alter table audit_log enable row level security;
create policy "admin read audit" on audit_log for select using (my_role() = 'admin');

create or replace function audit_changes() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare d jsonb := '{}';
begin
  if tg_op = 'INSERT' then
    d := jsonb_build_object('name', new.name);
  elsif tg_table_name = 'profiles' then
    if new.role        is distinct from old.role        then d := d || jsonb_build_object('role', jsonb_build_array(old.role, new.role)); end if;
    if new.facility_id is distinct from old.facility_id then d := d || jsonb_build_object('facility_id', jsonb_build_array(old.facility_id, new.facility_id)); end if;
    if new.suspended   is distinct from old.suspended   then d := d || jsonb_build_object('suspended', jsonb_build_array(old.suspended, new.suspended)); end if;
  elsif tg_table_name = 'facilities' then
    if new.verified  is distinct from old.verified  then d := d || jsonb_build_object('verified', jsonb_build_array(old.verified, new.verified)); end if;
    if new.plan      is distinct from old.plan      then d := d || jsonb_build_object('plan', jsonb_build_array(old.plan, new.plan)); end if;
    if new.suspended is distinct from old.suspended then d := d || jsonb_build_object('suspended', jsonb_build_array(old.suspended, new.suspended)); end if;
  elsif tg_table_name = 'blood_requests' then
    if new.status is distinct from old.status then d := d || jsonb_build_object('status', jsonb_build_array(old.status, new.status)); end if;
    if new.verified_by_facility is distinct from old.verified_by_facility then d := d || jsonb_build_object('verified', jsonb_build_array(old.verified_by_facility, new.verified_by_facility)); end if;
  end if;
  if d <> '{}'::jsonb then
    insert into audit_log(actor, action, target_type, target_id, details)
    values (auth.uid(), lower(tg_op), tg_table_name, new.id::text, d);
  end if;
  return new;
end $$;
create trigger trg_audit_profiles   after update on profiles       for each row execute function audit_changes();
create trigger trg_audit_facilities after insert or update on facilities for each row execute function audit_changes();
create trigger trg_audit_requests   after update on blood_requests for each row execute function audit_changes();

-- ---------- أسعار الباقات والإحصاءات ----------
create table if not exists plan_prices (plan plan_tier primary key, monthly_egp int not null check (monthly_egp >= 0));
insert into plan_prices values ('free', 0), ('pro', 4500), ('enterprise', 25000) on conflict (plan) do nothing;
alter table plan_prices enable row level security;
create policy "prices read"  on plan_prices for select using (auth.uid() is not null);
create policy "prices admin" on plan_prices for all using (my_role() = 'admin') with check (my_role() = 'admin');

-- ---------- حملات الشركات ----------
create table if not exists campaigns (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  org_name     text not null,
  facility_id  uuid not null references facilities(id),
  address      text,
  location     geography(Point,4326),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  target_donors int not null default 50,
  join_code    text unique not null default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  status       text not null default 'active' check (status in ('draft','active','ended')),
  fee_egp      int not null default 0,            -- مصدر إيراد: رسوم تنظيم الحملة
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table if not exists campaign_signups (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  donor_id    uuid not null references profiles(id),
  slot_at     timestamptz,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, donor_id)
);
alter table campaigns        enable row level security;
alter table campaign_signups enable row level security;
create policy "campaigns read"   on campaigns for select using (status = 'active' or my_role() = 'admin' or facility_id = my_facility());
create policy "campaigns admin"  on campaigns for all using (my_role() = 'admin') with check (my_role() = 'admin');
create policy "campaigns staff"  on campaigns for all using (facility_id = my_facility()) with check (facility_id = my_facility());
create policy "signups donor"    on campaign_signups for all using (donor_id = auth.uid()) with check (donor_id = auth.uid() and my_role() = 'donor');
create policy "signups manage"   on campaign_signups for select using (
  my_role() = 'admin' or exists (select 1 from campaigns c where c.id = campaign_id and c.facility_id = my_facility()));

create or replace function join_campaign(p_code text, p_slot timestamptz default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare c campaigns;
begin
  if my_role() is distinct from 'donor' then raise exception 'donors only'; end if;
  select * into c from campaigns where join_code = upper(trim(p_code)) and status = 'active' and ends_at > now();
  if c.id is null then raise exception 'campaign not found'; end if;
  insert into campaign_signups(campaign_id, donor_id, slot_at) values (c.id, auth.uid(), coalesce(p_slot, c.starts_at))
  on conflict (campaign_id, donor_id) do update set slot_at = excluded.slot_at;
  return c.id;
end $$;

-- ---------- رحلة الكيس ----------
do $$ begin
  create type donation_status as enum ('collected','testing','ready','issued','transfused','discarded');
exception when duplicate_object then null; end $$;

create table if not exists donations (
  id                  uuid primary key default gen_random_uuid(),
  bag_code            text unique not null default upper(substr(md5(gen_random_uuid()::text), 1, 10)),
  donor_id            uuid not null references profiles(id),
  facility_id         uuid not null references facilities(id),
  current_facility_id uuid not null references facilities(id),
  blood_type          blood_type not null,
  campaign_id         uuid references campaigns(id),
  request_id          uuid references blood_requests(id),
  status              donation_status not null default 'collected',
  collected_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create table if not exists donation_events (
  id          bigserial primary key,
  donation_id uuid not null references donations(id) on delete cascade,
  status      donation_status not null,
  facility_id uuid references facilities(id),
  at          timestamptz not null default now()
);
alter table donations       enable row level security;
alter table donation_events enable row level security;
create policy "donations donor"  on donations for select using (donor_id = auth.uid());
create policy "donations staff"  on donations for select using (facility_id = my_facility() or current_facility_id = my_facility());
create policy "donations admin"  on donations for select using (my_role() = 'admin');
create policy "events read" on donation_events for select using (exists (
  select 1 from donations d where d.id = donation_id
    and (d.donor_id = auth.uid() or d.facility_id = my_facility() or d.current_facility_id = my_facility() or my_role() = 'admin')));

-- الموظف يسجل تبرعًا بعد مسح بطاقة QR الخاصة بالمتبرع
create or replace function record_donation(p_donor uuid, p_campaign uuid default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare fid uuid := my_facility(); d profiles; code text; did uuid;
begin
  if fid is null then raise exception 'not facility staff'; end if;
  select * into d from profiles where id = p_donor and role = 'donor' and not suspended;
  if d.id is null then raise exception 'donor not found'; end if;
  if d.blood_type is null then raise exception 'donor blood type unknown'; end if;
  if not donor_is_eligible(d) then raise exception 'donor not eligible yet'; end if;
  insert into donations(donor_id, facility_id, current_facility_id, blood_type, campaign_id)
  values (d.id, fid, fid, d.blood_type, p_campaign) returning id, bag_code into did, code;
  insert into donation_events(donation_id, status, facility_id) values (did, 'collected', fid);
  update profiles set last_donation_at = current_date where id = d.id;
  update appointments set status = 'done' where donor_id = d.id and status = 'booked';
  return code;
end $$;

-- تقدم الكيس في رحلته: فحص ← جاهز (يدخل المخزون) ← صُرف لطلب ← نُقل لمريض، أو استُبعد
create or replace function advance_donation(p_bag text, p_status donation_status, p_request uuid default null)
returns donation_status language plpgsql security definer set search_path = public, extensions as $$
declare fid uuid := my_facility(); d donations;
  ord constant donation_status[] := array['collected','testing','ready','issued','transfused']::donation_status[];
begin
  if fid is null then raise exception 'not facility staff'; end if;
  select * into d from donations where bag_code = upper(trim(p_bag)) and current_facility_id = fid for update;
  if d.id is null then raise exception 'bag not found at your facility'; end if;
  if d.status in ('transfused','discarded') then raise exception 'bag journey already closed'; end if;
  if p_status <> 'discarded' and array_position(ord, p_status) <> array_position(ord, d.status) + 1 then
    raise exception 'invalid step % -> %', d.status, p_status;
  end if;
  if p_status = 'ready' then
    perform record_movement(d.blood_type, 'deposit', 1, 'rbc', 'donation ' || d.bag_code);
  elsif p_status = 'issued' then
    perform record_movement(d.blood_type, 'issue', 1, 'rbc', 'donation ' || d.bag_code);
    if p_request is not null then
      update blood_requests set units_secured = units_secured + 1 where id = p_request and facility_id = fid;
    end if;
  elsif p_status = 'discarded' and d.status = 'ready' then
    perform record_movement(d.blood_type, 'expired', 1, 'rbc', 'discarded ' || d.bag_code);
  end if;
  update donations set status = p_status, request_id = coalesce(p_request, request_id), updated_at = now() where id = d.id;
  insert into donation_events(donation_id, status, facility_id) values (d.id, p_status, fid);
  return p_status;
end $$;

-- بطاقة QR: الموظف يقرأ الحد الأدنى من بيانات المتبرع (وتُسجَّل كل قراءة في سجل التدقيق)
create or replace function staff_lookup_donor(p_donor uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d profiles; n int; gap int;
begin
  if my_facility() is null then raise exception 'not facility staff'; end if;
  select * into d from profiles where id = p_donor and role = 'donor';
  if d.id is null then raise exception 'donor not found'; end if;
  select count(*) into n from donations where donor_id = d.id and status <> 'discarded';
  gap := case when d.sex = 'female' then 112 else 84 end;
  insert into audit_log(actor, action, target_type, target_id, details)
  values (auth.uid(), 'qr_lookup', 'profiles', d.id::text, jsonb_build_object('facility', my_facility()));
  return jsonb_build_object('name', d.full_name, 'blood_type', d.blood_type, 'eligible', donor_is_eligible(d) and not d.suspended,
    'last_donation', d.last_donation_at, 'next_eligible', case when d.last_donation_at is null then null else d.last_donation_at + gap end,
    'donations', n);
end $$;

-- ---------- الأوسمة والتحديات ----------
create or replace function my_achievements()
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare me profiles; n int; responses int; week_resp int; quarter int; badges text[] := '{}';
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null then return null; end if;
  select count(*) into n from donations where donor_id = me.id and status <> 'discarded';
  select count(*) into responses from donor_responses where donor_id = me.id;
  select count(*) into week_resp from donor_responses where donor_id = me.id and created_at > now() - interval '7 days';
  select count(*) into quarter from donations where donor_id = me.id and collected_at > now() - interval '90 days';
  if n >= 1  then badges := array_append(badges, 'first_donation'); end if;
  if n >= 5  then badges := array_append(badges, 'hero_5'); end if;
  if n >= 10 then badges := array_append(badges, 'super_10'); end if;
  if n >= 15 then badges := array_append(badges, 'legend_15'); end if;
  if n >= 1 and me.blood_type in ('O-','A-','B-','AB-') then badges := array_append(badges, 'rare_blood'); end if;
  if responses >= 1 then badges := array_append(badges, 'emergency_responder'); end if;
  return jsonb_build_object(
    'donations', n, 'lives_estimate', n * 3, 'points', n * 100 + responses * 50, 'badges', badges,
    'next_badge_at', case when n < 1 then 1 when n < 5 then 5 when n < 10 then 10 when n < 15 then 15 else null end,
    'challenges', jsonb_build_array(
      jsonb_build_object('id', 'weekly_response', 'done', week_resp >= 1, 'progress', least(week_resp, 1), 'goal', 1, 'points', 50),
      jsonb_build_object('id', 'quarter_donation', 'done', quarter >= 1, 'progress', least(quarter, 1), 'goal', 1, 'points', 100),
      jsonb_build_object('id', 'rare_standby', 'done', me.available and me.blood_type in ('O-','A-','B-','AB-'), 'progress', case when me.available then 1 else 0 end, 'goal', 1, 'points', 30)
    ));
end $$;

-- بطل الأسبوع: من اختار الظهور فقط، وبالاسم الأول فقط
create or replace function hero_of_week()
returns table(rank int, display_name text, points int)
language sql stable security definer set search_path = public, extensions as $$
  with s as (
    select p.id, split_part(p.full_name, ' ', 1) as dname,
      (select count(*) from donations d where d.donor_id = p.id and d.collected_at > now() - interval '7 days')::int * 100
      + (select count(*) from donor_responses r where r.donor_id = p.id and r.created_at > now() - interval '7 days')::int * 50 as pts
    from profiles p where p.role = 'donor' and p.show_on_leaderboard and not p.suspended)
  select (row_number() over (order by pts desc))::int, dname, pts from s where pts > 0 order by pts desc limit 10
$$;

-- ---------- فرز الطلبات حسب الأولوية ----------
create or replace function triage_my_requests()
returns table(request_id uuid, blood_type blood_type, units_left int, urgency urgency_level, waiting_hours numeric,
              stock_same_type int, score int, reasons text[])
language sql stable security definer set search_path = public, extensions as $$
  with r as (
    select r.*, (r.units_needed - r.units_secured) as left_units,
      extract(epoch from now() - r.created_at) / 3600 as wait_h,
      coalesce((select sum(i.units) from inventory i where i.facility_id = r.facility_id and i.blood_type = r.blood_type
                and i.component = r.component and i.expires_at >= current_date), 0)::int as stock
    from blood_requests r
    where r.facility_id = my_facility() and r.status in ('open','matching','partially_fulfilled'))
  select r.id, r.blood_type, r.left_units, r.urgency, round(r.wait_h::numeric, 1), r.stock,
    (case r.urgency when 'critical' then 60 when 'urgent' then 35 else 10 end
     + least(r.wait_h, 48)::int / 2
     + case when r.stock < r.left_units then 15 else 0 end
     + case when r.needed_by is not null and r.needed_by < now() + interval '6 hours' then 20 else 0 end)::int,
    array_remove(array[
      case when r.urgency = 'critical' then 'critical' end,
      case when r.wait_h >= 24 then 'waiting_24h' end,
      case when r.stock < r.left_units then 'insufficient_stock' end,
      case when r.needed_by is not null and r.needed_by < now() + interval '6 hours' then 'due_soon' end,
      case when not r.verified_by_facility then 'unverified' end], null)
  from r order by 7 desc
$$;

-- ---------- التقارير اليومية للمنشأة ----------
create table if not exists facility_reports (
  facility_id uuid not null references facilities(id) on delete cascade,
  report_date date not null default current_date,
  lang        text not null default 'ar',
  content     text not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  primary key (facility_id, report_date, lang)
);
alter table facility_reports enable row level security;
create policy "reports staff" on facility_reports for all using (facility_id = my_facility()) with check (facility_id = my_facility());
create policy "reports admin" on facility_reports for select using (my_role() = 'admin');

-- ---------- إحصاءات المدير ----------
create or replace function admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare j jsonb;
begin
  if my_role() is distinct from 'admin' then raise exception 'admin only'; end if;
  select jsonb_build_object(
    'donors',            (select count(*) from profiles where role = 'donor' and not suspended),
    'donors_eligible',   (select count(*) from profiles p where role = 'donor' and not suspended and donor_is_eligible(p)),
    'beneficiaries',     (select count(*) from profiles where role = 'beneficiary'),
    'staff',             (select count(*) from profiles where role = 'facility_staff'),
    'facilities_verified', (select count(*) from facilities where verified and not suspended),
    'facilities_pending',  (select count(*) from facilities where not verified),
    'facilities_suspended',(select count(*) from facilities where suspended),
    'users_suspended',   (select count(*) from profiles where suspended),
    'requests_open',     (select count(*) from blood_requests where status in ('open','matching','partially_fulfilled')),
    'requests_fulfilled_30d', (select count(*) from blood_requests where status = 'fulfilled' and fulfilled_at > now() - interval '30 days'),
    'avg_fulfil_hours_30d', (select round(avg(extract(epoch from fulfilled_at - created_at) / 3600)::numeric, 1)
                             from blood_requests where fulfilled_at > now() - interval '30 days'),
    'donations_30d',     (select count(*) from donations where collected_at > now() - interval '30 days'),
    'lives_estimate_total', (select count(*) * 3 from donations where status <> 'discarded'),
    'mrr_egp',           (select coalesce(sum(pp.monthly_egp), 0) from facilities f join plan_prices pp on pp.plan = f.plan
                          where f.verified and not f.suspended),
    'campaign_fees_30d', (select coalesce(sum(fee_egp), 0) from campaigns where created_at > now() - interval '30 days'),
    'by_plan',           (select coalesce(jsonb_object_agg(plan, n), '{}') from (select plan, count(*) n from facilities where verified and not suspended group by plan) x),
    'by_blood_type',     (select coalesce(jsonb_object_agg(blood_type, n), '{}') from (select blood_type, count(*) n from profiles where role = 'donor' and blood_type is not null group by blood_type) x)
  ) into j;
  return j;
end $$;

-- ---------- الصلاحيات على الدوال ----------
do $$
declare f text;
begin
  foreach f in array array[
    'join_campaign(text, timestamptz)', 'record_donation(uuid, uuid)', 'advance_donation(text, donation_status, uuid)',
    'staff_lookup_donor(uuid)', 'my_achievements()', 'hero_of_week()', 'triage_my_requests()', 'admin_stats()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
