// تعدد اللغات: العربية، الإنجليزية، الفرنسية، الأوردو، الهندية، التركية
// - يُحفظ الاختيار على الجهاز وفي الملف الشخصي (ليرد الوكيل الذكي وواتساب بنفس اللغة)
// - العربية والأوردو من اليمين لليسار؛ تغيير الاتجاه على الهاتف يعيد تشغيل الواجهة مرة واحدة
import { useSyncExternalStore } from "react";
import { I18nManager, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import * as Updates from "expo-updates";
import ar from "../locales/ar";
import en from "../locales/en";
import fr from "../locales/fr";
import ur from "../locales/ur";
import hi from "../locales/hi";
import tr from "../locales/tr";
import type { Dict } from "../locales/ar";

export type Lang = "ar" | "en" | "fr" | "ur" | "hi" | "tr";
export const LANGS: { code: Lang; name: string; rtl: boolean }[] = [
  { code: "ar", name: "العربية", rtl: true },
  { code: "en", name: "English", rtl: false },
  { code: "fr", name: "Français", rtl: false },
  { code: "ur", name: "اردو", rtl: true },
  { code: "hi", name: "हिन्दी", rtl: false },
  { code: "tr", name: "Türkçe", rtl: false },
];
const DICTS: Record<Lang, Dict> = { ar, en, fr, ur, hi, tr };
const KEY = "sbb.lang";
const isLang = (x: unknown): x is Lang => typeof x === "string" && x in DICTS;
export const isRTL = (l: Lang) => LANGS.find((x) => x.code === l)!.rtl;

const device = getLocales()[0]?.languageCode;
let current: Lang = isLang(device) ? device : "ar";
const listeners = new Set<() => void>();

function applyDirection(l: Lang) {
  const rtl = isRTL(l);
  if (Platform.OS === "web") {
    if (typeof document !== "undefined") { document.documentElement.dir = rtl ? "rtl" : "ltr"; document.documentElement.lang = l; }
    return;
  }
  if (I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
    Updates.reloadAsync().catch(() => {}); // الاتجاه يُطبَّق بعد إعادة التشغيل
  }
}

/** يُستدعى مرة عند بدء التطبيق */
export async function initLang() {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (isLang(saved)) current = saved;
  } catch { /* تخزين غير متاح */ }
  applyDirection(current);
  listeners.forEach((f) => f());
}

export async function setLang(l: Lang, persistToProfile?: (l: Lang) => Promise<unknown>) {
  current = l;
  try { await AsyncStorage.setItem(KEY, l); } catch { /* ignore */ }
  await persistToProfile?.(l).catch(() => {});
  listeners.forEach((f) => f());
  applyDirection(l);
}

export const getLang = () => current;
export const useLang = () =>
  useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => current);
export const useT = () => DICTS[useLang()];

/** استبدال {x} بالقيم: fmt(t.eligibleAfter, { date }) */
export const fmt = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

/** محاذاة النص حسب اتجاه اللغة الحالية (للنصوص المكتوبة بأي لغة) */
export const textAlign = () => (isRTL(current) ? "right" : "left") as "right" | "left";
