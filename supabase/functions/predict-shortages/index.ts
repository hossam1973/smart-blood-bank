// =====================================================================
// POST /functions/v1/predict-shortages   (يقابل /api/predict-shortages في النموذج الأولي)
// body: { season, surge, horizon_days, lang: "ar"|"en", component? }
// 1) يحسب التنبؤ بمحرك رياضي ثابت (نفس كود التطبيق) → الأرقام دائمًا متاحة.
// 2) يطلب من Claude خطة تدخل تشغيلية مخصصة (Structured Output).
// 3) إذا تأخر النموذج أو فشل أو رفض → خطة القواعد الثابتة فورًا (source: "rules").
// =====================================================================
import Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  BLOOD_TYPES, forecastAll, type ForecastParams, type Intervention, ruleBasedInterventions,
  type Season, type StockInput, type Surge, type TypeForecast,
} from "../_shared/forecast.ts";

const MODEL = "claude-opus-5-5";
const AI_TIMEOUT_MS = 15_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SEASONS: Season[] = ["none", "ramadan", "hajj", "summer", "flu", "holidays"];
const SURGES: Surge[] = ["moderate", "high", "code_red"];

const InterventionsSchema = z.object({
  interventions: z.array(z.object({
    kind: z.enum(["donor_recall", "inter_hospital_borrow", "conserve_usage", "mobile_campaign", "monitor"]),
    priority: z.enum(["now", "24h", "this_week"]),
    blood_types: z.array(z.enum(BLOOD_TYPES)),
    title: z.string(),
    detail: z.string(),
  })),
});

async function aiInterventions(f: TypeForecast[], p: ForecastParams, lang: "ar" | "en", facilityName: string) {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("no_api_key"); // بدون مفتاح → خطة القواعد فورًا
  const anthropic = new Anthropic();
  const compact = f.map(({ trajectory: _t, ...x }) => x); // المسار اليومي غير لازم للنموذج
  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(InterventionsSchema) },
    system:
      "You are an operations advisor for a hospital blood bank. Given a deterministic shortage forecast, " +
      "propose 3-6 concrete, prioritized operational interventions (donor recall, inter-hospital borrowing, " +
      "conserving usage via Patient Blood Management, mobile drives timed to the season, monitoring). " +
      "Use only the numbers provided; never invent stock figures. Do not give patient-level clinical orders; " +
      "anything clinical must defer to the hospital transfusion committee. Blood donation is voluntary and unpaid — " +
      "never suggest buying blood or paying donors. " +
      `Write title and detail in ${lang === "ar" ? "Arabic" : "English"}, concise (detail ≤ 2 sentences).`,
    messages: [{
      role: "user",
      content: JSON.stringify({ facility: facilityName, season: p.season, surge: p.surge, horizon_days: p.horizon_days, forecast: compact }),
    }],
  }, { timeout: AI_TIMEOUT_MS, maxRetries: 0 });

  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("no_ai_output");
  return response.parsed_output.interventions as Intervention[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const params: ForecastParams = {
    season: SEASONS.includes(body.season) ? body.season : "none",
    surge: SURGES.includes(body.surge) ? body.surge : "moderate",
    horizon_days: Math.max(7, Math.min(30, Number(body.horizon_days) || 14)),
  };
  const lang: "ar" | "en" = body.lang === "en" ? "en" : "ar";

  const { data: me } = await sb.from("profiles").select("facility_id, facilities(name)").eq("id", user.id).single();
  if (!me?.facility_id) return json({ error: "not_facility_staff" }, 403);

  const { data: inputs, error } = await sb.rpc("forecast_inputs", { p_facility: me.facility_id, p_component: body.component ?? "rbc" });
  if (error) return json({ error: error.message }, 500);

  const forecast = forecastAll((inputs ?? []).map((r: StockInput) => ({
    ...r, units: Number(r.units), safety_stock: Number(r.safety_stock),
    burn_rate: Number(r.burn_rate), inflow_rate: Number(r.inflow_rate),
  })), params);

  let interventions: Intervention[];
  let source: "ai" | "rules" = "ai";
  try {
    // @ts-ignore — العلاقة المتداخلة من Supabase
    interventions = await aiInterventions(forecast, params, lang, me.facilities?.name ?? "");
  } catch (e) {
    console.warn("AI fallback:", (e as Error).message);
    interventions = ruleBasedInterventions(forecast, params, lang);
    source = "rules";
  }

  return json({ params, generated_at: new Date().toISOString(), forecast, interventions, source });
});
