// =====================================================================
// POST /functions/v1/whatsapp-webhook  — Rafeeq on WhatsApp (Twilio)
// Twilio posts form data (From, Body). We verify X-Twilio-Signature with
// TWILIO_AUTH_TOKEN, map the phone to a registered profile, run a READ-ONLY
// tool set scoped to that profile, and answer with TwiML.
// Deploy with verify_jwt = false (Twilio sends no JWT; the signature is the auth).
// Secrets: TWILIO_AUTH_TOKEN, ANTHROPIC_API_KEY. Optional: APP_LINK.
// =====================================================================
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-opus-5-5";
const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];
const MAX_TURNS = 5;
const KEEP = 8; // messages remembered per phone

const SYSTEM = `You are "Rafeeq" (رفيق), the Smart Blood Bank assistant, answering on WhatsApp.
Reply in the language of the user's message (Arabic, English, French, Urdu, Hindi or Turkish). Be brief: WhatsApp-sized answers, max ~8 short lines, no markdown tables.
Use the tools for every fact; never invent stock, places or numbers. No medical diagnosis. In emergencies first tell them to call an ambulance (123 Egypt, 997 Saudi Arabia).
Never reveal donors' personal data. Donation is voluntary and unpaid; never suggest buying/selling blood.
On WhatsApp you can only look things up. To create a blood request or book a donation, send the app link.`;

const tools: Anthropic.Tool[] = [
  { name: "blood_compatibility", description: "Donor blood types compatible with a recipient type.", strict: true,
    input_schema: { type: "object", properties: { recipient: { type: "string", enum: BLOOD_TYPES } }, required: ["recipient"], additionalProperties: false } },
  { name: "search_inventory", description: "Compatible blood stock at verified facilities near the user's saved location, with Google Maps directions links.", strict: true,
    input_schema: { type: "object", properties: { blood_type: { type: "string", enum: BLOOD_TYPES } }, required: ["blood_type"], additionalProperties: false } },
  { name: "my_eligibility", description: "Whether this donor can donate now and the next eligible date.", strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "open_requests_near_me", description: "Open verified requests near this donor that their blood type can serve, with directions links.", strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
];

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
const twiml = (text: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xml(text.slice(0, 1500))}</Message></Response>`,
  { headers: { "Content-Type": "text/xml; charset=utf-8" } });
const dir = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

async function validTwilioSignature(url: string, params: URLSearchParams, signature: string, token: string) {
  const data = url + [...params.keys()].sort().map((k) => k + params.get(k)).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!token) return new Response("whatsapp not configured", { status: 503 });

  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const publicUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`;
  if (!(await validTwilioSignature(publicUrl, params, req.headers.get("X-Twilio-Signature") ?? "", token))) {
    return new Response("invalid signature", { status: 403 });
  }

  const from = (params.get("From") ?? "").replace(/^whatsapp:/, "");
  const text = (params.get("Body") ?? "").trim().slice(0, 1000);
  if (!from || !text) return twiml("…");

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const appLink = Deno.env.get("APP_LINK") ?? "";
  const { data: profile } = await sb.from("profiles").select("id,role,blood_type,sex,last_donation_at,available,suspended,lang").eq("phone", from).maybeSingle();
  if (!profile || profile.suspended) {
    return twiml(`مرحبًا 👋 هذا الرقم غير مسجل في بنك الدم الذكي. سجّل من التطبيق ثم راسلنا من نفس الرقم.\nWelcome! This number isn't registered yet. Sign up in the app, then message us from the same number.${appLink ? `\n${appLink}` : ""}`);
  }
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return twiml("المساعد غير مفعّل بعد. The assistant is not enabled yet.");

  const { data: point } = await sb.rpc("profile_point", { p_profile: profile.id }).maybeSingle();
  const loc = point as { lat: number; lng: number } | null;

  async function runTool(name: string, input: Record<string, unknown>) {
    switch (name) {
      case "blood_compatibility": {
        const { data } = await sb.rpc("compatible_donor_types", { recipient: input.recipient });
        return { compatible: data };
      }
      case "search_inventory": {
        if (!loc) return { error: "no saved location; ask the user to open the app once with location enabled" };
        const { data, error } = await sb.rpc("find_inventory_nearby", { p_blood_type: input.blood_type, p_component: "rbc", lat: loc.lat, lng: loc.lng, radius_km: 40 });
        if (error) throw error;
        return { results: (data ?? []).slice(0, 5).map((x: { facility_name: string; phone: string; blood_type: string; units: number; distance_km: number; f_lat: number; f_lng: number }) =>
          ({ facility: x.facility_name, phone: x.phone, blood_type: x.blood_type, units: x.units, km: x.distance_km, directions: dir(x.f_lat, x.f_lng) })) };
      }
      case "my_eligibility": {
        const gap = profile!.sex === "female" ? 112 : 84;
        const next = profile!.last_donation_at ? new Date(new Date(profile!.last_donation_at).getTime() + gap * 864e5) : null;
        return { role: profile!.role, blood_type: profile!.blood_type, eligible_now: !next || next <= new Date(), next_eligible_date: next?.toISOString().slice(0, 10) ?? "now" };
      }
      case "open_requests_near_me": {
        if (profile!.role !== "donor") return { error: "only for donors" };
        const { data, error } = await sb.rpc("open_requests_for_profile", { p_profile: profile!.id, radius_km: 25 });
        if (error) throw error;
        return { requests: (data ?? []).map((r: { facility_name: string; blood_type: string; units_left: number; urgency: string; distance_km: number; f_lat: number; f_lng: number }) =>
          ({ facility: r.facility_name, blood_type: r.blood_type, units_left: r.units_left, urgency: r.urgency, km: r.distance_km, directions: dir(r.f_lat, r.f_lng) })) };
      }
    }
    return { error: "unknown tool" };
  }

  const { data: session } = await sb.from("wa_sessions").select("messages").eq("phone", from).maybeSingle();
  const past = ((session?.messages ?? []) as { role: "user" | "assistant"; content: string }[]).slice(-KEEP);
  const history: Anthropic.MessageParam[] = [...past, { role: "user", content: text }];

  const anthropic = new Anthropic();
  let reply = "";
  try {
    for (let turn = 0; turn < MAX_TURNS && !reply; turn++) {
      const r = await anthropic.messages.create({
        model: MODEL, max_tokens: 4000, output_config: { effort: "low" },
        system: `${SYSTEM}\nUser role: ${profile.role}. Blood type: ${profile.blood_type ?? "unknown"}. Preferred language: ${profile.lang}.${appLink ? ` App link: ${appLink}` : ""}`,
        tools, messages: history,
      }, { timeout: 25_000, maxRetries: 1 });
      if (r.stop_reason === "refusal") { reply = "عذرًا، لا أستطيع المساعدة في هذا. Sorry, I can't help with that."; break; }
      history.push({ role: "assistant", content: r.content });
      if (r.stop_reason !== "tool_use") {
        reply = r.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
        break;
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of r.content) {
        if (b.type !== "tool_use") continue;
        try { results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(await runTool(b.name, b.input as Record<string, unknown>)) }); }
        catch (e) { results.push({ type: "tool_result", tool_use_id: b.id, is_error: true, content: String((e as Error).message ?? e) }); }
      }
      history.push({ role: "user", content: results });
    }
  } catch (e) {
    console.error(e);
    reply = "تعذّر الرد الآن، حاول بعد قليل. Please try again shortly.";
  }
  reply ||= "…";

  // نحفظ النص فقط (بدون خطوات الأدوات) — آخر KEEP رسائل
  const kept = [...past, { role: "user", content: text }, { role: "assistant", content: reply }].slice(-KEEP);
  await sb.from("wa_sessions").upsert({ phone: from, profile_id: profile.id, messages: kept, updated_at: new Date().toISOString() });
  return twiml(reply);
});
