import type { Profile } from "./supabase";

/** موعد الأهلية القادم (84 يومًا للرجال و112 للنساء) أو null إن كان مؤهلًا الآن */
export function nextEligible(p: Pick<Profile, "last_donation_at" | "sex">) {
  if (!p.last_donation_at) return null;
  const gap = p.sex === "female" ? 112 : 84;
  const d = new Date(new Date(p.last_donation_at).getTime() + gap * 864e5);
  return d > new Date() ? d : null;
}

/** بادئة رمز QR في بطاقة المتبرع */
export const QR_PREFIX = "sbb:donor:";
