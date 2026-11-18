// دعم تلقائي للعربية والإنجليزية حسب لغة الجهاز (مع إمكانية التبديل يدويًا)
import { getLocales } from "expo-localization";
import { useSyncExternalStore } from "react";

export type Lang = "ar" | "en";
let current: Lang = getLocales()[0]?.languageCode === "en" ? "en" : "ar";
const listeners = new Set<() => void>();

export const setLang = (l: Lang) => { current = l; listeners.forEach((f) => f()); };
export const useLang = () =>
  useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => current);

const dict = {
  ar: {
    forecastTitle: "التنبؤ الذكي بنقص المخزون",
    forecastBtn: "تنبؤ المخزون",
    season: "الموسم", surge: "ضغط المستشفى", horizon: "أفق التنبؤ",
    days: "يوم", units: "وحدة", perDay: "/يوم",
    seasons: { none: "عادي", ramadan: "🌙 رمضان", hajj: "🕋 الحج والعمرة", summer: "☀️ الصيف والسفر", flu: "❄️ الإنفلونزا", holidays: "🎉 الأعياد والعطلات" },
    surges: { moderate: "معتدل", high: "مرتفع +25%", code_red: "كود أحمر +60%" },
    risk: { critical: "🚨 خطر حاد", warning: "⚠️ إنذار مبكر", stable: "🟢 مستقر" },
    current: "الرصيد", safety: "الحد الآمن", burn: "الصرف", inflow: "الإيداع", net: "الفجوة الصافية",
    depletion: "النفاد خلال", noDepletion: "لا نفاد متوقع", on: "في",
    issue: "صرف", deposit: "إيداع",
    chart: "منحنى الاستنزاف — 14 يومًا", criticalLine: "الحد الآمن",
    plan: "خطة التدخل الاستباقي", aiSource: "مولّدة بالذكاء الاصطناعي", rulesSource: "خطة احتياطية فورية",
    recall: "إطلاق نداء فوري للمتبرعين", recallDone: (n: number, t: string) => `تم إرسال النداء إلى ${n} متبرع مؤهل (${t}).`,
    recallNone: "لا توجد فصائل في خطر حاليًا.", cooldown: "تم إرسال نداء لهذه الفصائل خلال آخر 6 ساعات.",
    priority: { now: "فورًا", "24h": "خلال 24 ساعة", this_week: "هذا الأسبوع" },
    offline: "تعذّر الاتصال — الأرقام محسوبة على الجهاز.",
    assumptions: "المعاملات الموسمية تقديرية وتُعاير تلقائيًا من بيانات منشأتك بمرور الوقت.",
  },
  en: {
    forecastTitle: "AI Shortage Prediction",
    forecastBtn: "AI Inventory",
    season: "Season", surge: "Hospital intake surge", horizon: "Forecast horizon",
    days: "days", units: "units", perDay: "/day",
    seasons: { none: "Normal", ramadan: "🌙 Ramadan", hajj: "🕋 Hajj & Umrah", summer: "☀️ Summer travel", flu: "❄️ Flu season", holidays: "🎉 Eid & holidays" },
    surges: { moderate: "Moderate", high: "High +25%", code_red: "Code Red +60%" },
    risk: { critical: "🚨 Critical", warning: "⚠️ Warning", stable: "🟢 Stable" },
    current: "Stock", safety: "Safety", burn: "Burn", inflow: "Inflow", net: "Net gap",
    depletion: "Depletes in", noDepletion: "No depletion expected", on: "on",
    issue: "Issue", deposit: "Deposit",
    chart: "14-day depletion trajectory", criticalLine: "Safety level",
    plan: "AI actionable interventions", aiSource: "AI-generated", rulesSource: "Instant fallback plan",
    recall: "Smart Donor Recall", recallDone: (n: number, t: string) => `Recall sent to ${n} eligible donors (${t}).`,
    recallNone: "No blood types at risk right now.", cooldown: "These types were recalled in the last 6 hours.",
    priority: { now: "Now", "24h": "Within 24h", this_week: "This week" },
    offline: "Offline — figures computed on device.",
    assumptions: "Seasonal factors are estimates and auto-calibrate from your facility's data over time.",
  },
};

export const useT = () => dict[useLang()];
