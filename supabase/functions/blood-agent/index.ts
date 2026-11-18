// =====================================================================
// وكيل الذكاء الاصطناعي لبنك الدم — Supabase Edge Function (Deno)
// - يعمل باسم المستخدم (JWT) فتُطبَّق صلاحيات RLS على كل أداة.
// - يختلف سلوكه حسب الدور: متبرع / مستفيد / موظف منشأة.
// =====================================================================
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 8;

const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];
const COMPONENTS = ["whole", "rbc", "plasma", "platelets"];

const SYSTEM = `أنت "رفيق"، المساعد الذكي لمنصة بنك الدم الذكي.
مهمتك: ربط المرضى والمستفيدين بالمتبرعين والمستشفيات وبنوك الدم القريبة بأسرع وأدق طريقة.
القواعد:
- تحدث بالعربية بلغة بسيطة وودودة، وبإيجاز.
- استخدم الأدوات للحصول على بيانات حقيقية؛ لا تخمّن أرقام المخزون أو أماكن المتبرعين أبدًا.
- لا تقدم تشخيصًا طبيًا. أسئلة الأهلية الطبية الدقيقة تُحال لطبيب بنك الدم.
- في الحالات الحرجة (نزيف، حادث) ابدأ بنصيحة الاتصال بالإسعاف فورًا ثم ساعد في إيجاد الدم.
- لا تكشف أي بيانات شخصية عن المتبرعين (أسماء، أرقام، مواقع دقيقة) — أعطِ أعدادًا ومسافات تقريبية فقط.
- التبرع بالدم تطوعي؛ لا تقترح أبدًا شراء أو بيع الدم.
- قبل إنشاء طلب دم أو حجز موعد، لخّص التفاصيل واطلب تأكيد المستخدم صراحة.`;

const ROLE_HINT: Record<string, string> = {
  donor: "المستخدم متبرع: ساعده في معرفة أهليته، الطلبات القريبة المتوافقة، وحجز موعد تبرع.",
  beneficiary: "المستخدم مستفيد/مريض أو قريب مريض: ساعده في إيجاد مخزون متوافق قريب وإنشاء طلب دم.",
  facility_staff: "المستخدم موظف في منشأة طبية: ساعده في قراءة المخزون، النقص المتوقع، وإطلاق نداءات للمتبرعين.",
  admin: "المستخدم مدير المنصة.",
};

const tools: Anthropic.Tool[] = [
  {
    name: "blood_compatibility",
    description: "يرجع فصائل الدم التي يمكن نقلها لمريض بفصيلة معينة (كريات حمراء).",
    strict: true,
    input_schema: {
      type: "object",
      properties: { recipient: { type: "string", enum: BLOOD_TYPES } },
      required: ["recipient"],
      additionalProperties: false,
    },
  },
  {
    name: "search_inventory",
    description: "يبحث عن مخزون دم متوافق في المنشآت الموثقة القريبة من موقع المستخدم الحالي.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        blood_type: { type: "string", enum: BLOOD_TYPES },
        component: { type: "string", enum: COMPONENTS },
        radius_km: { type: "integer" },
      },
      required: ["blood_type", "component", "radius_km"],
      additionalProperties: false,
    },
  },
  {
    name: "my_eligibility",
    description: "يتحقق من أهلية المستخدم (المتبرع) للتبرع الآن وموعد أهليته القادم.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "open_requests_near_me",
    description: "يرجع طلبات الدم المفتوحة القريبة والمتوافقة مع فصيلة المتبرع.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { radius_km: { type: "integer" } },
      required: ["radius_km"],
      additionalProperties: false,
    },
  },
  {
    name: "create_blood_request",
    description: "ينشئ طلب دم جديد. استخدمه فقط بعد تأكيد المستخدم الصريح للتفاصيل.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        facility_id: { type: "string" },
        blood_type: { type: "string", enum: BLOOD_TYPES },
        component: { type: "string", enum: COMPONENTS },
        units_needed: { type: "integer" },
        urgency: { type: "string", enum: ["routine", "urgent", "critical"] },
        user_confirmed: { type: "boolean" },
      },
      required: ["facility_id", "blood_type", "component", "units_needed", "urgency", "user_confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "count_matching_donors",
    description: "لموظفي المنشآت: عدد المتبرعين المؤهلين القريبين لطلب معين (أعداد فقط، بدون بيانات شخصية).",
    strict: true,
    input_schema: {
      type: "object",
      properties: { request_id: { type: "string" }, radius_km: { type: "integer" } },
      required: ["request_id", "radius_km"],
      additionalProperties: false,
    },
  },
];

type Ctx = { sb: ReturnType<typeof createClient>; userId: string; lat?: number; lng?: number };

async function runTool(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  const { sb } = ctx;
  switch (name) {
    case "blood_compatibility": {
      const { data, error } = await sb.rpc("compatible_donor_types", { recipient: input.recipient });
      if (error) throw error;
      return { compatible_donor_types: data };
    }
    case "search_inventory": {
      if (ctx.lat == null || ctx.lng == null) return { error: "موقع المستخدم غير متاح؛ اطلب منه تفعيل الموقع." };
      const { data, error } = await sb.rpc("find_inventory_nearby", {
        p_blood_type: input.blood_type, p_component: input.component,
        lat: ctx.lat, lng: ctx.lng, radius_km: Math.min(Number(input.radius_km) || 30, 200),
      });
      if (error) throw error;
      return { results: (data ?? []).slice(0, 10) };
    }
    case "my_eligibility": {
      const { data, error } = await sb.from("profiles")
        .select("blood_type,last_donation_at,sex,weight_kg,birth_date,available").eq("id", ctx.userId).single();
      if (error) throw error;
      const gap = data.sex === "female" ? 112 : 84;
      const next = data.last_donation_at
        ? new Date(new Date(data.last_donation_at).getTime() + gap * 864e5) : null;
      return { ...data, min_days_between_donations: gap,
               next_eligible_date: next?.toISOString().slice(0, 10) ?? "الآن",
               eligible_by_interval: !next || next <= new Date() };
    }
    case "open_requests_near_me": {
      const { data, error } = await sb.rpc("open_requests_for_donor", {
        radius_km: Math.min(Number(input.radius_km) || 25, 100) });
      if (error) throw error;
      return { requests: (data ?? []).slice(0, 10) };
    }
    case "create_blood_request": {
      if (input.user_confirmed !== true) return { error: "يجب الحصول على تأكيد المستخدم أولًا." };
      const units = Number(input.units_needed);
      if (!Number.isInteger(units) || units < 1 || units > 20) return { error: "عدد الوحدات يجب أن يكون بين 1 و20." };
      const { data, error } = await sb.from("blood_requests").insert({
        requester_id: ctx.userId, facility_id: input.facility_id, blood_type: input.blood_type,
        component: input.component, units_needed: units, urgency: input.urgency,
      }).select("id,status").single();
      if (error) throw error;
      return { created: data, note: "سيتم إشعار المتبرعين المتوافقين بعد توثيق المنشأة للطلب." };
    }
    case "count_matching_donors": {
      const { data, error } = await sb.rpc("find_donors_for_request", {
        req_id: input.request_id, radius_km: Math.min(Number(input.radius_km) || 15, 100), max_results: 500 });
      if (error) throw error;
      const byType: Record<string, number> = {};
      for (const d of data ?? []) byType[d.blood_type] = (byType[d.blood_type] ?? 0) + 1;
      return { total: (data ?? []).length, by_blood_type: byType };
    }
    default:
      return { error: `أداة غير معروفة: ${name}` };
  }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });

    if (!Deno.env.get("ANTHROPIC_API_KEY")) {
      return json({ reply: "المساعد الذكي غير مفعّل بعد. أضف مفتاح ANTHROPIC_API_KEY في إعدادات المشروع." });
    }
    const anthropic = new Anthropic(); // يقرأ ANTHROPIC_API_KEY من أسرار الدالة

    const { messages, lat, lng } = await req.json() as {
      messages: Anthropic.MessageParam[]; lat?: number; lng?: number;
    };
    const { data: profile } = await sb.from("profiles").select("role,blood_type").eq("id", user.id).single();
    const role = profile?.role ?? "beneficiary";
    const ctx: Ctx = { sb, userId: user.id, lat, lng };

    // نعيد المحادثة كما هي دون قصّ: قصّها قد يفصل tool_use عن tool_result فيرفض الـAPI الطلب
    const history: Anthropic.MessageParam[] = [...messages];
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
          { type: "text", text: `${ROLE_HINT[role] ?? ""}\nفصيلة المستخدم: ${profile?.blood_type ?? "غير معروفة"}` },
        ],
        tools,
        messages: history,
      } as never) as unknown as Anthropic.Message;

      if (response.stop_reason === "refusal") {
        return json({ reply: "عذرًا، لا أستطيع المساعدة في هذا الطلب. للحالات الطارئة اتصل بالإسعاف." });
      }

      history.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        const reply = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n");
        await sb.from("agent_logs").insert({
          user_id: user.id, role, question: lastUserText(messages), tools_used: toolsUsed });
        return json({ reply, messages: history });
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        toolsUsed.push(block.name);
        try {
          const out = await runTool(block.name, block.input as Record<string, unknown>, ctx);
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: String((e as Error).message ?? e) });
        }
      }
      history.push({ role: "user", content: results });
    }
    return json({ reply: "استغرق الطلب خطوات أكثر من المسموح، حاول صياغة السؤال بشكل أبسط." });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "agent_failed" }), { status: 500, headers: cors });
  }
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { ...cors, "Content-Type": "application/json" } });
}
function lastUserText(msgs: Anthropic.MessageParam[]) {
  const m = [...msgs].reverse().find((x) => x.role === "user");
  return typeof m?.content === "string" ? m.content : "";
}
