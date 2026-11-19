// الصحة الشخصية وجاهزية التبرع: إدخال المؤشرات الحيوية → مؤشر جاهزية 0–100 + أسباب + نصائح قبل التبرع
// القياسات خاصة بالمتبرع فقط (RLS)، والتقييم يتم في قاعدة البيانات (readiness_for)
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { fmt, getLang, useT } from "../lib/i18n";
import { Button, C, Card, Field, notify, s } from "../lib/ui";

type Readiness = { status: "ready" | "conditional" | "defer" | "unknown"; score: number | null; blockers: string[]; cautions: string[];
  measured_at: string | null; hb_min: number; vitals?: Record<string, number | string | null> };
const FIELDS = ["systolic", "diastolic", "hemoglobin", "pulse", "weight_kg", "water_ml", "sleep_hours"] as const;
const LABEL: Record<(typeof FIELDS)[number], string> = { systolic: "systolic", diastolic: "diastolic", hemoglobin: "hemoglobin", pulse: "pulse", weight_kg: "weight", water_ml: "water", sleep_hours: "sleep" };
const TONE = { ready: C.ok, conditional: "#E08A00", defer: C.red, unknown: C.mute };

export default function Health() {
  const t = useT();
  const T = t as unknown as Record<string, string>;
  const [r, setR] = useState<Readiness | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.rpc("my_readiness");
    const rd = data as Readiness | null;
    setR(rd);
    if (rd?.vitals) setForm(Object.fromEntries(FIELDS.map((k) => [k, rd.vitals?.[k] == null ? "" : String(rd.vitals[k])])));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const row: Record<string, unknown> = { donor_id: user!.id, source: "manual" };
    for (const k of FIELDS) if (form[k]?.trim()) row[k] = Number(form[k].replace(",", "."));
    setBusy(true);
    const { error } = await supabase.from("donor_vitals").insert(row);
    setBusy(false);
    if (error) return notify(t.error, error.message);
    notify("✅", t.vitalsSaved); load();
  };

  const status = r?.status ?? "unknown";
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card style={{ alignItems: "center", borderColor: TONE[status], borderWidth: 2 }}>
        <Text style={s.label}>{t.readinessScore}</Text>
        <Text style={[s.h1, { fontSize: 44, color: TONE[status] }]}>{r?.score ?? "—"}{r?.score != null ? "%" : ""}</Text>
        <Text style={[s.h2, { color: TONE[status] }]}>{T[`rs_${status}`]}</Text>
        {r?.measured_at && <Text style={[s.p, { fontSize: 12 }]}>{new Date(r.measured_at).toLocaleString(getLang())}</Text>}
        {[...(r?.blockers ?? []).map((b) => ["⛔", fmt(T[`rb_${b}`] ?? b, { min: r?.hb_min ?? "" })]), ...(r?.cautions ?? []).map((c) => ["⚠️", T[`rc_${c}`] ?? c])]
          .map(([icon, text]) => <Text key={text} style={[s.p, { alignSelf: "stretch" }]}>{icon} {text}</Text>)}
        {status === "ready" || status === "conditional" ? <Button title={t.smartSchedule} onPress={() => router.push("/suggest")} /> : null}
      </Card>

      <Card>
        {FIELDS.map((k) => (
          <Field key={k} label={T[LABEL[k]]} keyboardType="decimal-pad" value={form[k] ?? ""} onChangeText={(v) => setForm({ ...form, [k]: v })} />
        ))}
        <Button title={t.saveVitals} onPress={save} disabled={busy || !FIELDS.some((k) => form[k]?.trim())} />
        <Text style={[s.p, { fontSize: 12 }]}>🔒 {t.vitalsPrivacy}</Text>
        <Text style={[s.p, { fontSize: 12 }]}>⌚ {t.healthSyncNote}</Text>
      </Card>

      <Card>
        <Text style={s.h2}>{t.tipsTitle}</Text>
        {[t.tip_iron, t.tip_tea, t.tip_water].map((x) => (
          <View key={x} style={{ flexDirection: "row", gap: 8 }}><Text style={s.p}>•</Text><Text style={[s.p, { flex: 1 }]}>{x}</Text></View>
        ))}
        <Text style={[s.p, { fontSize: 12 }]}>{t.healthDisclaimer}</Text>
      </Card>
    </ScrollView>
  );
}
