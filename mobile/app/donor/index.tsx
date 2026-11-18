// بوابة المتبرع: الأهلية + الإتاحة + الطلبات القريبة المتوافقة
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { getMyProfile, type Profile, supabase, toPoint } from "../../lib/supabase";
import { getCoords } from "../../lib/location";
import { Button, C, Card, s } from "../../lib/ui";

type Req = { request_id: string; facility_name: string; blood_type: string; units_left: number;
             urgency: "routine" | "urgent" | "critical"; distance_km: number };
const URG = { routine: "عادي", urgent: "عاجل", critical: "حرج 🚨" };

function nextEligible(p: Profile) {
  if (!p.last_donation_at) return null;
  const gap = p.sex === "female" ? 112 : 84;
  const d = new Date(new Date(p.last_donation_at).getTime() + gap * 864e5);
  return d > new Date() ? d : null;
}

export default function Donor() {
  const [me, setMe] = useState<Profile | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const c = await getCoords();
    const p = await getMyProfile();
    if (c && p) await supabase.from("profiles").update({ location: toPoint(c.lat, c.lng) }).eq("id", p.id);
    const { data } = await supabase.rpc("open_requests_for_donor", { radius_km: 25 });
    setMe(p); setReqs((data ?? []) as Req[]); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (v: boolean) => {
    if (!me) return;
    setMe({ ...me, available: v });
    await supabase.from("profiles").update({ available: v }).eq("id", me.id);
  };

  const respond = async (r: Req) => {
    const { error } = await supabase.from("donor_responses").insert({ request_id: r.request_id, donor_id: me!.id });
    if (error) return Alert.alert("تنبيه", error.code === "23505" ? "سبق أن استجبت لهذا الطلب" : error.message);
    Alert.alert("شكرًا لك ❤️", `تم إبلاغ ${r.facility_name}. توجّه إليها ومعك بطاقة الهوية.`);
  };

  const next = me ? nextEligible(me) : null;

  return (
    <FlatList
      style={s.screen} contentContainerStyle={s.pad} data={reqs} keyExtractor={(r) => r.request_id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListHeaderComponent={
        <View style={{ gap: 14 }}>
          <Card>
            <View style={s.row}>
              <Text style={s.h2}>فصيلتك</Text>
              <Text style={[s.badge, { fontSize: 18 }]}>{me?.blood_type ?? "—"}</Text>
            </View>
            <Text style={[s.p, { color: next ? C.mute : C.ok }]}>
              {next ? `يمكنك التبرع مجددًا بعد ${next.toLocaleDateString("ar-EG")}` : "أنت مؤهل للتبرع الآن ✅"}
            </Text>
            <View style={s.row}>
              <Text style={s.label}>متاح لاستقبال نداءات الطوارئ</Text>
              <Switch value={me?.available ?? false} onValueChange={toggle} trackColor={{ true: C.red }} />
            </View>
          </Card>
          <Button title="اسأل المساعد الذكي" kind="ghost" onPress={() => router.push("/agent")} />
          <Text style={s.h2}>طلبات قريبة تحتاج فصيلتك ({reqs.length})</Text>
        </View>
      }
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListEmptyComponent={<Text style={s.p}>لا توجد طلبات متوافقة قريبة الآن. سنرسل لك إشعارًا عند الحاجة.</Text>}
      renderItem={({ item }) => (
        <Card style={item.urgency === "critical" ? { borderColor: C.red } : undefined}>
          <View style={s.row}>
            <Text style={s.h2}>{item.facility_name}</Text>
            <Text style={s.badge}>{item.blood_type}</Text>
          </View>
          <Text style={s.p}>{URG[item.urgency]} · {item.units_left} وحدة متبقية · {item.distance_km} كم</Text>
          <Button title="سأتبرع" onPress={() => respond(item)} disabled={!!next} />
        </Card>
      )}
    />
  );
}
