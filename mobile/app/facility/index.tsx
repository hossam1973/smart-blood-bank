// بوابة المنشأة: المخزون + الطلبات مرتبة بالأولوية (فرز ذكي) + مسح بطاقات المتبرعين + رحلة الأكياس + التقرير اليومي + التنبؤ
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { BLOOD_TYPES, type BloodType, getMyProfile, supabase } from "../../lib/supabase";
import { fmt, useT } from "../../lib/i18n";
import { Button, C, Card, Field, s, notify } from "../../lib/ui";
import ShortageForecast from "../../components/ShortageForecast";
import Demand48 from "../../components/Demand48";

type Inv = { id: string; blood_type: BloodType; units: number; expires_at: string };
type Triage = { request_id: string; blood_type: BloodType; units_left: number; urgency: string; waiting_hours: number;
  stock_same_type: number; score: number; reasons: string[] };
const STEPS = ["collected", "testing", "ready", "issued", "transfused"];

export default function Facility() {
  const t = useT();
  const T = t as unknown as Record<string, string>;
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [inv, setInv] = useState<Inv[]>([]);
  const [queue, setQueue] = useState<Triage[]>([]);
  const [bag, setBag] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const p = await getMyProfile();
    const fid = p?.facility_id ?? null;
    setFacilityId(fid);
    if (fid) {
      const [{ data: i }, { data: q }] = await Promise.all([
        supabase.from("inventory").select("id,blood_type,units,expires_at").eq("facility_id", fid).eq("component", "rbc"),
        supabase.rpc("triage_my_requests"),
      ]);
      setInv((i ?? []) as Inv[]); setQueue((q ?? []) as Triage[]);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!facilityId) return <View style={[s.screen, s.pad]}><Text style={s.p}>{t.notLinked}</Text></View>;

  const valid = (x: Inv) => new Date(x.expires_at) >= new Date(new Date().toDateString());
  const totals = Object.fromEntries(BLOOD_TYPES.map((b) => [b, inv.filter((x) => x.blood_type === b && valid(x)).reduce((a, x) => a + x.units, 0)]));
  const soon = inv.filter((x) => x.units > 0 && valid(x) && new Date(x.expires_at).getTime() - Date.now() < 7 * 864e5);

  const adjust = async (b: BloodType, delta: number) => {
    const { error } = await supabase.rpc("record_movement", { p_blood_type: b, p_kind: delta > 0 ? "deposit" : "issue", p_units: Math.abs(delta) });
    if (error) notify("⚠️", error.message);
    load();
  };

  const verify = async (r: Triage) => {
    await supabase.from("blood_requests").update({ verified_by_facility: true, status: "matching" }).eq("id", r.request_id);
    const { data } = await supabase.rpc("find_donors_for_request", { req_id: r.request_id, radius_km: 15, max_results: 200 });
    notify("✅", fmt(t.verifiedMsg, { n: data?.length ?? 0 }));
    load();
  };

  // تقدم كيس خطوة واحدة في رحلته (الحالة الحالية تُقرأ من الخادم)
  const advance = async (discard = false) => {
    const code = bag.trim().toUpperCase();
    if (!code) return;
    const { data: d } = await supabase.from("donations").select("status").eq("bag_code", code).maybeSingle();
    if (!d) return notify("⚠️", `${t.bagCode}: ${code}`);
    const next = discard ? "discarded" : STEPS[STEPS.indexOf(d.status) + 1];
    if (!next) return;
    const { error } = await supabase.rpc("advance_donation", { p_bag: code, p_status: next });
    if (error) return notify("⚠️", error.message);
    notify("✅", T[`j_${next}`] ?? next); setBag(""); load();
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button title={t.scanDonor} onPress={() => router.push("/scan")} /></View>
        <View style={{ flex: 1 }}><Button title={t.dailyReport} kind="ghost" onPress={() => router.push("/report")} /></View>
      </View>

      <Text style={s.h2}>{t.inventoryTitle}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {BLOOD_TYPES.map((b) => (
          <Card key={b} style={{ width: "47%", borderColor: totals[b] < 5 ? C.red : C.line }}>
            <View style={s.row}><Text style={s.badge}>{b}</Text><Text style={[s.h1, { fontSize: 22 }]}>{totals[b]}</Text></View>
            {totals[b] < 5 && <Text style={[s.p, { color: C.red, fontSize: 13 }]}>{t.low}</Text>}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => adjust(b, -1)} style={[s.chip, { flex: 1, alignItems: "center" }]}><Text style={s.chipText}>− {t.issue}</Text></Pressable>
              <Pressable onPress={() => adjust(b, 1)} style={[s.chip, { flex: 1, alignItems: "center" }]}><Text style={s.chipText}>+ {t.deposit}</Text></Pressable>
            </View>
          </Card>
        ))}
      </View>

      {soon.length > 0 && (
        <Card style={{ backgroundColor: C.redSoft }}>
          <Text style={s.h2}>{t.expiringSoon}</Text>
          {soon.map((x) => <Text key={x.id} style={s.p}>{x.blood_type}: {x.units} — {x.expires_at}</Text>)}
          <Text style={s.p}>{t.expiringHint}</Text>
        </Card>
      )}

      <Text style={s.h2}>{fmt(t.incoming, { n: queue.length })}</Text>
      {queue.map((r) => (
        <Card key={r.request_id} style={r.score >= 60 ? { borderColor: C.red, borderWidth: 2 } : undefined}>
          <View style={s.row}>
            <Text style={s.label}>{fmt(t.score, { n: r.score })} · {T[`urg_${r.urgency}`]}</Text>
            <Text style={s.badge}>{r.blood_type}</Text>
          </View>
          <Text style={s.p}>{r.units_left} {t.units} · {fmt(t.sameTypeStock, { n: r.stock_same_type })}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {r.reasons.map((x) => <Text key={x} style={[s.badge, { fontSize: 12 }]}>{T[`r_${x}`] ?? x}</Text>)}
          </View>
          {r.reasons.includes("unverified") && <Button title={t.verifyAndCall} onPress={() => verify(r)} />}
        </Card>
      ))}

      <Card>
        <Text style={s.h2}>{t.advanceBag}</Text>
        <Field label={t.bagCode} value={bag} onChangeText={setBag} autoCapitalize="characters" />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 2 }}><Button title={t.nextStep} onPress={() => advance(false)} disabled={!bag.trim()} /></View>
          <View style={{ flex: 1 }}><Button title={t.discard} kind="ghost" onPress={() => advance(true)} disabled={!bag.trim()} /></View>
        </View>
      </Card>

      <Demand48 />

      <ShortageForecast facilityId={facilityId} />

      <Button title={t.donorDensityMap} kind="ghost" onPress={() => router.push("/map")} />
      <Button title={t.askAgent} kind="ghost" onPress={() => router.push("/agent")} />
    </ScrollView>
  );
}
