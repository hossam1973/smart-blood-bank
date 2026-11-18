-- 006 — دالة سجل التدقيق تُستدعى من المشغّلات فقط
revoke execute on function audit_changes() from public, anon, authenticated;
