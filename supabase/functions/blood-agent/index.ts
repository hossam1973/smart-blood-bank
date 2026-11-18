// =====================================================================
// Rafeeq — Smart Blood Bank AI agent (Supabase Edge Function, Deno)
// Runs as the calling user (JWT) so RLS applies to every tool. Replies in the
// user's language (ar, en, fr, ur, hi, tr). Behaviour and tools vary by role.
// =====================================================================
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { forecastAll, type StockInput } from "../_shared/forecast.ts";

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 8;
const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];
const COMPONENTS = ["whole", "rbc", "plasma", "platelets"];
const LANGS: Record<string, string> = { ar: "Arabic", en: "English", fr: "French", ur: "Urdu", hi: "Hindi", tr: "Turkish" };

const SYSTEM = `You are "Rafeeq" (رفيق), the assistant of the Smart Blood Bank platform. You connect patients and their families with donors, hospitals and blood banks nearby, quickly and accurately.
Language: reply in the language of the user's latest message. If it is unclear, use the user's preferred language given below. Supported: Arabic, English, French, Urdu, Hindi, Turkish. Keep replies short, warm and plain.
Rules:
- Use the tools for every fact about stock, requests, eligibility, campaigns or forecasts. Never invent numbers or places.
- No medical diagnosis. Detailed medical eligibility questions go to the blood bank doctor.
- In emergencies (bleeding, accident) first tell the user to call an ambulance (123 in Egypt, 997 in Saudi Arabia), then help find blood.
- Never reveal donors' personal data (names, phones, exact locations); give counts and approximate distances only.
- Blood donation is voluntary and unpaid. Never suggest buying or selling blood or paying donors.
- Before creating a blood request, summarize the details and ask for explicit confirmation; call create_blood_request only after the user confirms.
- For hospital staff, triage and forecasts are decision support; final clinical decisions belong to the physician and transfusion committee.`;

const ROLE_HINT: Record<string, string> = {
  donor: "The user is a donor: help with eligibility, nearby compatible requests, badges/challenges, campaigns and booking a donation.",
  beneficiary: "The user is a patient or a patient's relative: help find compatible stock nearby and create a blood request.",
  facility_staff: "The user is hospital/blood-bank staff: help read stock, the shortage forecast, request triage and donor recalls.",
  admin: "The user is a platform administrator.",
};

const obj = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: "object" as const, properties, required, additionalProperties: false });

const tools: Anthropic.Tool[] = [
  { name: "blood_compatibility", description: "Donor blood types compatible with a recipient type (red cells).", strict: true,
    input_schema: obj({ recipient: { type: "string", enum: BLOOD_TYPES } }, ["recipient"]) },
  { name: "search_inventory", description: "Search verified facilities near the user's current location for compatible blood stock.", strict: true,
    input_schema: obj({ blood_type: { type: "string", enum: BLOOD_TYPES }, component: { type: "string", enum: COMPONENTS }, radius_km: { type: "integer" } }, ["blood_type", "component", "radius_km"]) },
  { name: "my_eligibility", description: "Whether the signed-in donor can donate now and their next eligible date.", strict: true, input_schema: obj({}, []) },
  { name: "open_requests_near_me", description: "Open verified blood requests near the donor that their blood type can serve.", strict: true,
    input_schema: obj({ radius_km: { type: "integer" } }, ["radius_km"]) },
  { name: "create_blood_request", description: "Create a blood request. Only after the user explicitly confirmed the summarized details.", strict: true,
    input_schema: obj({ facility_id: { type: "string" }, blood_type: { type: "string", enum: BLOOD_TYPES }, component: { type: "string", enum: COMPONENTS },
      units_needed: { type: "integer" }, urgency: { type: "string", enum: ["routine", "urgent", "critical"] }, user_confirmed: { type: "boolean" } },
      ["facility_id", "blood_type", "component", "units_needed", "urgency", "user_confirmed"]) },
  { name: "my_achievements", description: "Donor's donations count, estimated lives saved, points, badges and current challenges.", strict: true, input_schema: obj({}, []) },
  { name: "active_campaigns", description: "Active donation campaigns (company drives) the donor can join, with join codes.", strict: true, input_schema: obj({}, []) },
  { name: "triage_requests", description: "Staff only: open requests at the user's facility ranked by priority score with reasons.", strict: true, input_schema: obj({}, []) },
  { name: "facility_forecast", description: "Staff only: days until depletion and risk per blood type at the user's facility.", strict: true,
    input_schema: obj({ season: { type: "string", enum: ["none", "ramadan", "hajj", "summer", "flu", "holidays"] }, surge: { type: "string", enum: ["moderate", "high", "code_red"] } }, ["season", "surge"]) },
  { name: "count_matching_donors", description: "Staff only: number of eligible donors near a request (counts only, no personal data).", strict: true,
    input_schema: obj({ request_id: { type: "string" }, radius_km: { type: "integer" } }, ["request_id", "radius_km"]) },
];

type Ctx = { sb: SupabaseClient; userId: string; lat?: number; lng?: number };

async function runTool(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  const { sb } = ctx;
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    return data;
  };
  switch (name) {
    case "blood_compatibility":
      return { compatible_donor_types: await rpc("compatible_donor_types", { recipient: input.recipient }) };
    case "search_inventory":
      if (ctx.lat == null || ctx.lng == null) return { error: "user location unavailable; ask them to enable location" };
      return { results: ((await rpc("find_inventory_nearby", { p_blood_type: input.blood_type, p_component: input.component,
        lat: ctx.lat, lng: ctx.lng, radius_km: Math.min(Number(input.radius_km) || 30, 200) })) ?? []).slice(0, 10) };
    case "my_eligibility": {
      const { data, error } = await sb.from("profiles").select("blood_type,last_donation_at,sex,weight_kg,birth_date,available").eq("id", ctx.userId).single();
      if (error) throw error;
      const gap = data.sex === "female" ? 112 : 84;
      const next = data.last_donation_at ? new Date(new Date(data.last_donation_at).getTime() + gap * 864e5) : null;
      return { ...data, min_days_between_donations: gap, next_eligible_date: next?.toISOString().slice(0, 10) ?? "now", eligible_by_interval: !next || next <= new Date() };
    }
    case "open_requests_near_me":
      return { requests: ((await rpc("open_requests_for_donor", { radius_km: Math.min(Number(input.radius_km) || 25, 100) })) ?? []).slice(0, 10) };
    case "create_blood_request": {
      if (input.user_confirmed !== true) return { error: "explicit user confirmation required first" };
      const units = Number(input.units_needed);
      if (!Number.isInteger(units) || units < 1 || units > 20) return { error: "units must be between 1 and 20" };
      const { data, error } = await sb.from("blood_requests").insert({ requester_id: ctx.userId, facility_id: input.facility_id,
        blood_type: input.blood_type, component: input.component, units_needed: units, urgency: input.urgency }).select("id,status").single();
      if (error) throw error;
      return { created: data, note: "Compatible donors are notified after the facility verifies the request." };
    }
    case "my_achievements":
      return await rpc("my_achievements");
    case "active_campaigns": {
      const { data, error } = await sb.from("campaigns").select("title,org_name,address,starts_at,ends_at,join_code").eq("status", "active")
        .gt("ends_at", new Date().toISOString()).order("starts_at").limit(10);
      if (error) throw error;
      return { campaigns: data };
    }
    case "triage_requests":
      return { requests: await rpc("triage_my_requests") };
    case "facility_forecast": {
      const { data: me } = await sb.from("profiles").select("facility_id").eq("id", ctx.userId).single();
      if (!me?.facility_id) return { error: "not facility staff" };
      const rows = (await rpc("forecast_inputs", { p_facility: me.facility_id })) as StockInput[];
      const f = forecastAll(rows.map((r) => ({ ...r, units: +r.units, safety_stock: +r.safety_stock, burn_rate: +r.burn_rate, inflow_rate: +r.inflow_rate })),
        { season: input.season as never, surge: input.surge as never, horizon_days: 14 });
      return { forecast: f.map(({ trajectory: _t, ...x }) => x) };
    }
    case "count_matching_donors": {
      const data = (await rpc("find_donors_for_request", { req_id: input.request_id, radius_km: Math.min(Number(input.radius_km) || 15, 100), max_results: 500 })) ?? [];
      const byType: Record<string, number> = {};
      for (const d of data) byType[d.blood_type] = (byType[d.blood_type] ?? 0) + 1;
      return { total: data.length, by_blood_type: byType };
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const NOT_ENABLED: Record<string, string> = {
  ar: "المساعد الذكي غير مفعّل بعد.", en: "The AI assistant is not enabled yet.", fr: "L'assistant IA n'est pas encore activé.",
  ur: "AI معاون ابھی فعال نہیں ہے۔", hi: "AI सहायक अभी सक्रिय नहीं है।", tr: "Yapay zekâ asistanı henüz etkin değil.",
};

const REFUSAL: Record<string, string> = {
  ar: "عذرًا، لا أستطيع المساعدة في هذا الطلب. في الطوارئ اتصل بالإسعاف.", en: "Sorry, I can't help with that. In an emergency, call an ambulance.",
  fr: "Désolé, je ne peux pas aider avec cela. En cas d'urgence, appelez une ambulance.", ur: "معذرت، میں اس میں مدد نہیں کر سکتا۔ ہنگامی صورت میں ایمبولینس کو کال کریں۔",
  hi: "क्षमा करें, मैं इसमें मदद नहीं कर सकता। आपात स्थिति में एम्बुलेंस को कॉल करें।", tr: "Üzgünüm, bu konuda yardımcı olamam. Acil durumda ambulans çağırın.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json() as { messages: Anthropic.MessageParam[]; lat?: number; lng?: number; lang?: string };
    const { data: profile } = await sb.from("profiles").select("role,blood_type,lang,suspended").eq("id", user.id).single();
    const lang = LANGS[body.lang ?? ""] ? body.lang! : (profile?.lang ?? "ar");
    if (profile?.suspended) return json({ error: "suspended" }, 403);
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ reply: NOT_ENABLED[lang] ?? NOT_ENABLED.en });

    const anthropic = new Anthropic();
    const role = profile?.role ?? "beneficiary";
    const ctx: Ctx = { sb, userId: user.id, lat: body.lat, lng: body.lng };
    const history: Anthropic.MessageParam[] = [...body.messages];
    const toolsUsed: string[] = [];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: [
          { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
          { type: "text", text: `${ROLE_HINT[role] ?? ""}\nPreferred language: ${LANGS[lang]}.\nUser blood type: ${profile?.blood_type ?? "unknown"}.` },
        ],
        tools,
        messages: history,
      } as never) as unknown as Anthropic.Message;

      if (response.stop_reason === "refusal") return json({ reply: REFUSAL[lang] ?? REFUSAL.en });

      history.push({ role: "assistant", content: response.content });
      if (response.stop_reason !== "tool_use") {
        const reply = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n");
        const last = [...body.messages].reverse().find((m) => m.role === "user");
        await sb.from("agent_logs").insert({ user_id: user.id, role, question: typeof last?.content === "string" ? last.content : "", tools_used: toolsUsed });
        return json({ reply, messages: history });
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        toolsUsed.push(block.name);
        try {
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(await runTool(block.name, block.input as Record<string, unknown>, ctx)) });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: String((e as Error).message ?? e) });
        }
      }
      history.push({ role: "user", content: results });
    }
    return json({ reply: "…" });
  } catch (e) {
    console.error(e);
    return json({ error: "agent_failed" }, 500);
  }
});
