// بوابة المنشأة (مستشفى / بنك دم / مركز طبي): المخزون + الطلبات الواردة + نداء المتبرعين
// تعمل على الموبايل والويب (expo start --web) — مناسبة لشاشات مكاتب بنوك الدم
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { BLOOD_TYPES, type BloodType, getMyProfile, supabase } from "../../lib/supabase";
import { Button, C, Card, s } from "../../lib/ui";
import ShortageForecast from "../../components/ShortageForecast";

type Inv = { id: string; blood_type: BloodType; units: number; expires_at: string };
type Req = { id: string; blood_type: string; units_needed: number; units_secured: number; urgency: string; status: string; verified_by_facility: boolean };
const LOW = 5; // حد التنبيه بنقص المخزون

export default function Facility() {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [inv, setInv] = useState<Inv[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const p = await getMyProfile();
    const fid = p?.facility_id ?? null;
    setFacilityId(fid);
    if (fid) {
      const [{ data: i }, { data: r }] = await Promise.all([
        supabase.from("inventory").select("id,blood_type,units,expires_at").eq("facility_id", fid).eq("component", "rbc"),
        supabase.from("blood_requests").select("id,blood_type,units_needed,units_secured,urgency,status,verified_by_facility")
          .eq("facility_id", fid).in("status", ["open", "matching", "partially_fulfilled"]).order("created_at", { ascending: false }),
      ]);
      setInv((i ?? []) as Inv[]); setReqs((r ?? []) as Req[]);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!facilityId) return (
    <View style={[s.screen, s.pad]}><Text style={s.p}>حسابك بانتظار ربطه بمنشأة موثقة. سيتواصل معك فريق المنصة.</Text></View>
  );

  const totals = Object.fromEntries(BLOOD_TYPES.map((t) => [t, inv.filter((x) => x.blood_type === t).reduce((a, b) => a + b.units, 0)]));
  const soon = inv.filter((x) => new Date(x.expires_at).getTime() - Date.now() < 7 * 864e5 && x.units > 0);

  const adjust = async (t: BloodType, delta: number) => {
    // كل تعديل يُسجَّل كحركة صرف/إيداع → يغذي معدلات محرك التنبؤ
    const { error } = await supabase.rpc("record_movement", {
      p_blood_type: t, p_kind: delta > 0 ? "deposit" : "issue", p_units: Math.abs(delta) });
    if (error) Alert.alert("⚠️", error.message);
    load();
  };

  const verify = async (r: Req) => {
    await supabase.from("blood_requests").update({ verified_by_facility: true, status: "matching" }).eq("id", r.id);
    const { data } = await supabase.rpc("find_donors_for_request", { req_id: r.id, radius_km: 15, max_results: 200 });
    // الإشعارات الفعلية تُرسل من دالة خادم (Edge Function + Expo Push) لحماية بيانات المتبرعين
    Alert.alert("تم التوثيق", `يوجد ${data?.length ?? 0} متبرع مؤهل ضمن 15 كم وسيتم إشعارهم.`);
    load();
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={s.h2}>المخزون (كريات حمراء)</Text>
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 }}>
        {BLOOD_TYPES.map((t) => (
          <Card key={t} style={{ width: "47%", borderColor: totals[t] < LOW ? C.red : C.line }}>
            <View style={s.row}><Text style={s.badge}>{t}</Text><Text style={[s.h1, { fontSize: 22 }]}>{totals[t]}</Text></View>
            {totals[t] < LOW && <Text style={[s.p, { color: C.red, fontSize: 13 }]}>مخزون منخفض</Text>}
            <View style={{ flexDirection: "row-reverse", gap: 8 }}>
              <Pressable onPress={() => adjust(t, 1)} style={[s.chip, { flex: 1, alignItems: "center" }]}><Text style={s.chipText}>+1</Text></Pressable>
              <Pressable onPress={() => adjust(t, -1)} style={[s.chip, { flex: 1, alignItems: "center" }]}><Text style={s.chipText}>−1</Text></Pressable>
            </View>
          </Card>
        ))}
      </View>

      {soon.length > 0 && (
        <Card style={{ backgroundColor: C.redSoft }}>
          <Text style={s.h2}>⚠️ وحدات تنتهي خلال 7 أيام</Text>
          {soon.map((x) => <Text key={x.id} style={s.p}>{x.blood_type}: {x.units} وحدة — {x.expires_at}</Text>)}
          <Text style={s.p}>اقتراح: انقلها لمنشأة قريبة تحتاجها عبر شبكة المنصة بدل إهدارها.</Text>
        </Card>
      )}

      {/* محرك التنبؤ الذكي مدمج أسفل المخزون (ويمكن فتحه أيضًا من زر الهيدر) */}
      <ShortageForecast facilityId={facilityId} />

      <Text style={s.h2}>الطلبات الواردة ({reqs.length})</Text>
      {reqs.map((r) => (
        <Card key={r.id}>
          <View style={s.row}><Text style={s.label}>{r.urgency === "critical" ? "حرج 🚨" : r.urgency === "urgent" ? "عاجل" : "عادي"}</Text><Text style={s.badge}>{r.blood_type}</Text></View>
          <Text style={s.p}>{r.units_secured}/{r.units_needed} وحدة · المتوفر لديكم من نفس الفصيلة: {totals[r.blood_type as BloodType] ?? 0}</Text>
          {!r.verified_by_facility && <Button title="توثيق الطلب ونداء المتبرعين" onPress={() => verify(r)} />}
        </Card>
      ))}

      <Button title="المساعد الذكي (تحليل المخزون)" kind="ghost" onPress={() => router.push("/agent")} />
    </ScrollView>
  );
}
