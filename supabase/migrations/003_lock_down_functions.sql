-- 003 — تقييد الدوال: البحث عن المتبرعين لموظفي المنشأة صاحبة الطلب فقط، ولا وصول لغير المسجّلين
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
    and (r.facility_id = my_facility() or my_role() = 'admin')
  order by (p.blood_type = r.blood_type) desc, st_distance(p.location, f.location)
  limit max_results
$$;

revoke execute on function find_donors_for_request(uuid, int, int) from public, anon;
revoke execute on function find_inventory_nearby(blood_type, blood_component, float8, float8, int) from public, anon;
revoke execute on function open_requests_for_donor(int) from public, anon;
revoke execute on function forecast_inputs(uuid, blood_component, int) from public, anon;
revoke execute on function record_movement(blood_type, movement_kind, int, blood_component, text, date) from public, anon;
revoke execute on function my_role() from public, anon;
revoke execute on function my_facility() from public, anon;
grant execute on function find_donors_for_request(uuid, int, int) to authenticated;
grant execute on function find_inventory_nearby(blood_type, blood_component, float8, float8, int) to authenticated;
grant execute on function open_requests_for_donor(int) to authenticated;
grant execute on function forecast_inputs(uuid, blood_component, int) to authenticated;
grant execute on function record_movement(blood_type, movement_kind, int, blood_component, text, date) to authenticated;
grant execute on function my_role() to authenticated;
grant execute on function my_facility() to authenticated;
