// =====================================================================
// POST /functions/v1/daily-report   body: { lang?: "ar"|"en"|"fr"|"ur"|"hi"|"tr", refresh?: boolean }
// Morning report for the caller's facility: shortage forecast, near-expiry units,
// priority requests and yesterday's movements. Generated once per day per language
// (cached in facility_reports). Claude writes the summary; without a key or on
// failure a template report is returned so the screen never stays empty.
// =====================================================================
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { forecastAll, type StockInput } from "../_shared/forecast.ts";

const MODEL = "claude-opus-5-5";
const LANGS: Record<string, string> = { ar: "Arabic", en: "English", fr: "French", ur: "Urdu", hi: "Hindi", tr: "Turkish" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Data = {
  facility: string; date: string;
  critical: { t: string; days: number | null; units: number }[]; warning: { t: string; days: number | null; units: number }[];
  expiring: { t: string; units: number; expires_at: string }[];
  top_requests: { blood_type: string; units_left: number; urgency: string; score: number; reasons: string[] }[];
  yesterday: { issued: number; deposited: number };
};

function templateReport(d: Data, lang: string): string {
  const ar = lang === "ar";
  const L = (a: string, e: string) => (ar ? a : e);
  const lines = [
    `${L("التقرير اليومي", "Daily report")} — ${d.facility} — ${d.date}`,
    `${L("خطر حاد", "Critical")}: ${d.critical.map((x) => `${x.t} (${x.days ?? "-"} ${L("يوم", "d")})`).join(", ") || L("لا شيء", "none")}`,
    `${L("إنذار مبكر", "Warning")}: ${d.warning.map((x) => `${x.t} (${x.days ?? "-"} ${L("يوم", "d")})`).join(", ") || L("لا شيء", "none")}`,
    `${L("تنتهي خلال 7 أيام", "Expiring within 7 days")}: ${d.expiring.map((x) => `${x.t}×${x.units}`).join(", ") || L("لا شيء", "none")}`,
    `${L("أولوية الطلبات", "Top requests")}: ${d.top_requests.map((r) => `${r.blood_type}×${r.units_left} (${r.score})`).join(", ") || L("لا شيء", "none")}`,
    `${L("أمس", "Yesterday")}: ${L("صرف", "issued")} ${d.yesterday.issued} · ${L("إيداع", "deposited")} ${d.yesterday.deposited}`,
  ];
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const lang = LANGS[body.lang] ? body.lang : "ar";

  const { data: me } = await sb.from("profiles").select("facility_id, facilities(name)").eq("id", user.id).single();
  if (!me?.facility_id) return json({ error: "not_facility_staff" }, 403);
  const today = new Date().toISOString().slice(0, 10);

  if (!body.refresh) {
    const { data: cached } = await sb.from("facility_reports").select("content,data,created_at")
      .eq("facility_id", me.facility_id).eq("report_date", today).eq("lang", lang).maybeSingle();
    if (cached) return json({ ...cached, cached: true });
  }

  const [{ data: inputs }, { data: triage }, { data: inv }, { data: mv }] = await Promise.all([
    sb.rpc("forecast_inputs", { p_facility: me.facility_id }),
    sb.rpc("triage_my_requests"),
    sb.from("inventory").select("blood_type,units,expires_at").eq("facility_id", me.facility_id).gt("units", 0)
      .gte("expires_at", today).lte("expires_at", new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)),
    sb.from("inventory_movements").select("kind,units").eq("facility_id", me.facility_id)
      .gte("created_at", new Date(Date.now() - 864e5).toISOString()),
  ]);
  const f = forecastAll(((inputs ?? []) as StockInput[]).map((r) => ({ ...r, units: +r.units, safety_stock: +r.safety_stock, burn_rate: +r.burn_rate, inflow_rate: +r.inflow_rate })),
    { season: "none", surge: "moderate", horizon_days: 14 });
  // @ts-ignore nested relation
  const facilityName: string = me.facilities?.name ?? "";
  const data: Data = {
    facility: facilityName, date: today,
    critical: f.filter((x) => x.risk === "critical").map((x) => ({ t: x.blood_type, days: x.days_until_depletion, units: x.units })),
    warning: f.filter((x) => x.risk === "warning").map((x) => ({ t: x.blood_type, days: x.days_until_depletion, units: x.units })),
    expiring: (inv ?? []).map((x: { blood_type: string; units: number; expires_at: string }) => ({ t: x.blood_type, units: x.units, expires_at: x.expires_at })),
    top_requests: (triage ?? []).slice(0, 5).map((r: { blood_type: string; units_left: number; urgency: string; score: number; reasons: string[] }) =>
      ({ blood_type: r.blood_type, units_left: r.units_left, urgency: r.urgency, score: r.score, reasons: r.reasons })),
    yesterday: {
      issued: (mv ?? []).filter((m: { kind: string }) => m.kind === "issue" || m.kind === "transfer_out").reduce((a: number, m: { units: number }) => a + m.units, 0),
      deposited: (mv ?? []).filter((m: { kind: string }) => m.kind === "deposit" || m.kind === "transfer_in").reduce((a: number, m: { units: number }) => a + m.units, 0),
    },
  };

  let content = templateReport(data, lang);
  let source = "template";
  if (Deno.env.get("ANTHROPIC_API_KEY")) {
    try {
      const anthropic = new Anthropic();
      const r = await anthropic.messages.create({
        model: MODEL, max_tokens: 2000, output_config: { effort: "low" },
        system: "You write a short morning operations brief for a hospital blood bank. Use only the JSON data given. " +
          "Structure: 1) one-line status, 2) urgent actions (max 4 bullets), 3) watch list. No patient-level clinical orders; " +
          "never suggest buying blood or paying donors. Plain text, no markdown headings, max 150 words. " +
          `Write in ${LANGS[lang]}.`,
        messages: [{ role: "user", content: JSON.stringify(data) }],
      }, { timeout: 20_000, maxRetries: 0 });
      const text = r.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
      if (r.stop_reason !== "refusal" && text) { content = text; source = "ai"; }
    } catch (e) {
      console.warn("report AI fallback:", (e as Error).message);
    }
  }

  await sb.from("facility_reports").upsert({ facility_id: me.facility_id, report_date: today, lang, content, data: { ...data, source } });
  return json({ content, data: { ...data, source }, created_at: new Date().toISOString(), cached: false });
});
