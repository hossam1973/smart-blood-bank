import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } },
);

export type Role = "donor" | "beneficiary" | "facility_staff" | "admin";
export type BloodType = "O-" | "O+" | "A-" | "A+" | "B-" | "B+" | "AB-" | "AB+";
export const BLOOD_TYPES: BloodType[] = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];

export type Profile = {
  id: string;
  role: Role;
  full_name: string;
  blood_type: BloodType | null;
  facility_id: string | null;
  available: boolean;
  last_donation_at: string | null;
  sex: "male" | "female" | null;
  suspended?: boolean;
  lang?: string;
  show_on_leaderboard?: boolean;
};

/** حفظ لغة المستخدم في ملفه ليستخدمها الوكيل الذكي ورسائل واتساب */
export async function saveLangToProfile(lang: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) await supabase.from("profiles").update({ lang }).eq("id", user.id);
}

export async function getMyProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return data as Profile | null;
}

/** Postgres geography يقبل صيغة WKT/EWKT */
export const toPoint = (lat: number, lng: number) => `SRID=4326;POINT(${lng} ${lat})`;

export const ROLE_HOME: Record<Role, string> = {
  donor: "/donor",
  beneficiary: "/beneficiary",
  facility_staff: "/facility",
  admin: "/admin",
};
