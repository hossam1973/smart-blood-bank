// =====================================================================
// AI Shortage Prediction Engine — محرك التنبؤ بنقص الدم
// كود TypeScript نقي (بدون اعتماديات) يُستخدم في الخادم (Deno) والتطبيق (React Native)
// حتى يحصل المستخدم على نفس الرقم في كل مكان، ويعمل التطبيق حتى بدون اتصال.
//
// ⚠️ المعاملات الموسمية أدناه افتراضات أولية (Priors) — يجب معايرتها من بيانات
//    الصرف والإيداع الفعلية لكل منشأة بعد 3-6 أشهر من التشغيل (انظر calibrate()).
// =====================================================================

export const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

export type Season = "none" | "ramadan" | "hajj" | "summer" | "flu" | "holidays";
export type Surge = "moderate" | "high" | "code_red";
export type Risk = "critical" | "warning" | "stable";

export type StockInput = {
  blood_type: BloodType;
  units: number;          // الرصيد الحالي
  safety_stock: number;   // الحد الآمن السريري
  burn_rate: number;      // متوسط الصرف اليومي (عمليات + حوادث) — آخر 14 يومًا
  inflow_rate: number;    // متوسط الإيداع اليومي من المتبرعين — آخر 14 يومًا
};

export type ForecastParams = { season: Season; surge: Surge; horizon_days: number; today?: Date };

export type TypeForecast = StockInput & {
  eff_burn: number;
  eff_inflow: number;
  net_daily: number;                 // الفجوة الصافية اليومية (سالب = استنزاف)
  days_until_depletion: number | null; // null = لا نفاد متوقع (رصيد متزايد)
  depletion_date: string | null;     // YYYY-MM-DD
  days_until_below_safety: number | null;
  risk: Risk;
  units_needed_for_horizon: number;  // وحدات يجب تأمينها للبقاء فوق الحد الآمن طوال الأفق
  trajectory: number[];              // الرصيد المتوقع يومًا بيوم (0..horizon)
};

// ---------------------------------------------------------------------
// المعاملات الموسمية: مضاعِف للصرف ومضاعِف للإيداع، مع تعديلات خاصة بفصائل معينة
// ---------------------------------------------------------------------
type SeasonFactor = { burn: number; inflow: number; typeBurn?: Partial<Record<BloodType, number>> };

export const SEASON_FACTORS: Record<Season, SeasonFactor> = {
  none: { burn: 1, inflow: 1 },
  // رمضان: انخفاض التبرع النهاري 38%، وتأجيل جزء من العمليات الاختيارية
  ramadan: { burn: 0.92, inflow: 0.62 },
  // الحج والعمرة: استنفار طوارئ وطلب حاد على الفصائل النادرة والسالبة
  hajj: { burn: 1.2, inflow: 0.9, typeBurn: { "O-": 1.35, "A-": 1.25, "B-": 1.25, "AB-": 1.2 } },
  // الصيف والسفر: انخفاض التبرع الروتيني للمقيمين 30%
  summer: { burn: 1.0, inflow: 0.7 },
  // الإنفلونزا الشتوية: استبعاد مؤقت للمتبرعين ذوي الأعراض التنفسية
  flu: { burn: 1.0, inflow: 0.8 },
  // الأعياد والعطلات الوطنية: ارتفاع حوادث الطرق وإغلاق بعض المراكز
  holidays: { burn: 1.25, inflow: 0.75, typeBurn: { "O-": 1.2, "O+": 1.15 } },
};

export const SURGE_FACTORS: Record<Surge, number> = { moderate: 1, high: 1.25, code_red: 1.6 };

export const RISK_THRESHOLDS = { critical: 4, warning: 8 }; // بالأيام

const round1 = (n: number) => Math.round(n * 10) / 10;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5).toISOString().slice(0, 10);

export function forecastType(s: StockInput, p: ForecastParams): TypeForecast {
  const sf = SEASON_FACTORS[p.season];
  const horizon = Math.max(1, Math.min(30, Math.round(p.horizon_days)));
  const today = p.today ?? new Date();

  const eff_burn = Math.max(0, s.burn_rate) * sf.burn * (sf.typeBurn?.[s.blood_type] ?? 1) * SURGE_FACTORS[p.surge];
  const eff_inflow = Math.max(0, s.inflow_rate) * sf.inflow;
  const net = eff_inflow - eff_burn;
  const units = Math.max(0, s.units);

  const days_until_depletion = net >= 0 ? null : units / -net;
  const days_until_below_safety =
    units <= s.safety_stock ? 0 : net >= 0 ? null : (units - s.safety_stock) / -net;

  let risk: Risk;
  if (days_until_depletion !== null && days_until_depletion < RISK_THRESHOLDS.critical) risk = "critical";
  else if (days_until_depletion !== null && days_until_depletion <= RISK_THRESHOLDS.warning) risk = "warning";
  else if (units < s.safety_stock) risk = "warning"; // رصيد تحت الحد الآمن حتى لو مستقر
  else risk = "stable";
  if (units === 0 && eff_burn > 0) risk = "critical";

  const trajectory = Array.from({ length: horizon + 1 }, (_, d) => round1(Math.max(0, units + net * d)));
  const endUnits = units + net * horizon;

  return {
    ...s,
    eff_burn: round1(eff_burn),
    eff_inflow: round1(eff_inflow),
    net_daily: round1(net),
    days_until_depletion: days_until_depletion === null ? null : round1(days_until_depletion),
    depletion_date: days_until_depletion === null ? null : addDays(today, Math.floor(days_until_depletion)),
    days_until_below_safety: days_until_below_safety === null ? null : round1(days_until_below_safety),
    risk,
    units_needed_for_horizon: Math.max(0, Math.ceil(s.safety_stock - endUnits)),
    trajectory,
  };
}

const RISK_ORDER: Record<Risk, number> = { critical: 0, warning: 1, stable: 2 };

export function forecastAll(stock: StockInput[], p: ForecastParams): TypeForecast[] {
  return stock
    .map((s) => forecastType(s, p))
    .sort((a, b) =>
      RISK_ORDER[a.risk] - RISK_ORDER[b.risk] ||
      (a.days_until_depletion ?? 1e9) - (b.days_until_depletion ?? 1e9));
}

// ---------------------------------------------------------------------
// خطة التدخل الاحتياطية (قواعد ثابتة) — تعمل فورًا إذا تعذّر الوصول لنموذج الذكاء الاصطناعي
// ---------------------------------------------------------------------
export type Intervention = {
  kind: "donor_recall" | "inter_hospital_borrow" | "conserve_usage" | "mobile_campaign" | "monitor";
  priority: "now" | "24h" | "this_week";
  blood_types: BloodType[];
  title: string;
  detail: string;
};

export function ruleBasedInterventions(f: TypeForecast[], p: ForecastParams, lang: "ar" | "en"): Intervention[] {
  const ar = lang === "ar";
  const crit = f.filter((x) => x.risk === "critical").map((x) => x.blood_type);
  const warn = f.filter((x) => x.risk === "warning").map((x) => x.blood_type);
  const need = (t: BloodType) => f.find((x) => x.blood_type === t)!.units_needed_for_horizon;
  const out: Intervention[] = [];

  if (crit.length) {
    out.push({
      kind: "donor_recall", priority: "now", blood_types: crit,
      title: ar ? "نداء فوري للمتبرعين" : "Immediate donor recall",
      detail: ar
        ? `استدعِ متبرعين مؤهلين من فصائل ${crit.join("، ")} — المطلوب تقريبًا: ${crit.map((t) => `${t}: ${need(t)} وحدة`).join("، ")}.`
        : `Recall eligible ${crit.join(", ")} donors — approx. needed: ${crit.map((t) => `${t}: ${need(t)} units`).join(", ")}.`,
    });
    out.push({
      kind: "inter_hospital_borrow", priority: "now", blood_types: crit,
      title: ar ? "تفعيل الاستعارة بين المستشفيات" : "Activate inter-hospital borrowing",
      detail: ar
        ? "اطلب تحويل وحدات من منشآت قريبة لديها فائض أو وحدات تقترب صلاحيتها من الانتهاء، مع التزام سلسلة التبريد."
        : "Request transfers from nearby facilities with surplus or near-expiry units, maintaining the cold chain.",
    });
    out.push({
      kind: "conserve_usage", priority: "24h", blood_types: crit,
      title: ar ? "ترشيد الاستهلاك" : "Conserve usage",
      detail: ar
        ? "راجع جدول العمليات الاختيارية مع لجنة نقل الدم، وطبّق سياسة إدارة دم المريض (PBM) لتقليل الوحدات لكل حالة."
        : "Review elective surgery schedule with the transfusion committee and apply Patient Blood Management (PBM).",
    });
  }
  if (warn.length) {
    const evening = p.season === "ramadan";
    out.push({
      kind: "mobile_campaign", priority: "this_week", blood_types: warn,
      title: ar ? "جدولة حملة تبرع متنقلة" : "Schedule a mobile donation drive",
      detail: ar
        ? `نظّم حملة ${evening ? "مسائية بعد الإفطار" : "في جامعة أو شركة قريبة"} تستهدف ${warn.join("، ")} قبل دخولها مرحلة الخطر.`
        : `Run a ${evening ? "post-iftar evening" : "university/corporate"} drive targeting ${warn.join(", ")} before they turn critical.`,
    });
  }
  if (!out.length) {
    out.push({
      kind: "monitor", priority: "this_week", blood_types: [],
      title: ar ? "الرصيد مستقر" : "Stock is stable",
      detail: ar ? "استمر في المتابعة اليومية وحافظ على الحد الآمن." : "Keep daily monitoring and maintain safety stock.",
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// معايرة المعاملات الموسمية من البيانات الفعلية (تُستخدم لاحقًا)
// actual / baseline لنفس المنشأة خلال فترة الموسم مقارنة بباقي السنة
// ---------------------------------------------------------------------
export function calibrate(seasonAvg: number, baselineAvg: number, prior: number, nDays: number): number {
  if (baselineAvg <= 0 || nDays <= 0) return prior;
  const observed = seasonAvg / baselineAvg;
  const w = Math.min(1, nDays / 60); // كلما زادت الأيام المرصودة زادت الثقة بالبيانات
  return w * observed + (1 - w) * prior;
}
