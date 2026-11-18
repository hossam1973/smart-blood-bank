// =====================================================================
// POST /functions/v1/donor-recall   — زر الإطلاق الفوري (Smart Donor Recall)
// body: { blood_types: ["O-","B-"], radius_km?: 25, lang?: "ar"|"en" }
// يستهدف متبرعين مؤهلين من *نفس* الفصائل المعرّضة للعجز (لتعويض نفس المخزون)
// قرب المنشأة، ويرسل إشعار Expo Push. لا تُعاد أي بيانات شخصية للمنشأة — عدد فقط.
// حماية من الإزعاج: نداء واحد لكل فصيلة لكل منشأة كل 6 ساعات.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const VALID = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const { data: me } = await asUser.from("profiles").select("facility_id").eq("id", user.id).single();
  if (!me?.facility_id) return json({ error: "not_facility_staff" }, 403);

  const body = await req.json().catch(() => ({}));
  const types: string[] = (body.blood_types ?? []).filter((t: string) => VALID.includes(t));
  if (!types.length) return json({ error: "blood_types required" }, 400);
  const radiusKm = Math.max(3, Math.min(60, Number(body.radius_km) || 25));

  // صلاحيات الخدمة مطلوبة لقراءة رموز إشعارات المتبرعين (محجوبة عن المستخدمين بـ RLS)
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const since = new Date(Date.now() - 6 * 3600e3).toISOString();
  const { data: recent } = await admin.from("donor_recalls").select("blood_types")
    .eq("facility_id", me.facility_id).gte("created_at", since);
  const cooled = new Set((recent ?? []).flatMap((r) => r.blood_types));
  const target = types.filter((t) => !cooled.has(t));
  if (!target.length) return json({ notified: 0, skipped: types, reason: "cooldown_6h" });

  const { data: facility } = await admin.from("facilities").select("name, location").eq("id", me.facility_id).single();
  const { data: donors, error } = await admin.rpc("eligible_donors_near_facility", {
    p_facility: me.facility_id, p_types: target, radius_km: radiusKm,
  });
  if (error) return json({ error: error.message }, 500);

  const ar = body.lang !== "en";
  const messages = (donors ?? []).filter((d: { push_token: string | null }) => d.push_token).map((d: { push_token: string; blood_type: string }) => ({
    to: d.push_token,
    sound: "default",
    priority: "high",
    title: ar ? `🩸 فصيلتك ${d.blood_type} مطلوبة الآن` : `🩸 Your type ${d.blood_type} is needed now`,
    body: ar ? `${facility?.name} يواجه نقصًا متوقعًا. تبرعك قد يمنع إلغاء عملية جراحية.`
             : `${facility?.name} faces a projected shortage. Your donation can prevent a cancelled surgery.`,
    data: { type: "recall", facility_id: me.facility_id },
  }));

  // Expo Push يقبل حتى 100 رسالة في الطلب الواحد
  for (let i = 0; i < messages.length; i += 100) {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }

  await admin.from("donor_recalls").insert({
    facility_id: me.facility_id, blood_types: target, donors_notified: messages.length, triggered_by: user.id,
  });
  return json({ notified: messages.length, eligible: (donors ?? []).length, blood_types: target, skipped: types.filter((t) => cooled.has(t)) });
});
