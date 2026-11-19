-- 009 — أحدث قياس حيوي: ترتيب ثابت عند تساوي الوقت (مُدمج أيضًا في 008)
do $$
declare src text;
begin
  select pg_get_functiondef('readiness_for(uuid)'::regprocedure) into src;
  src := replace(src, 'order by measured_at desc limit 1', 'order by measured_at desc, id desc limit 1');
  execute src;
end $$;
revoke execute on function readiness_for(uuid) from public, anon, authenticated;
