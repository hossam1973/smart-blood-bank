// بوابة المتبرع: الأهلية + الإتاحة + الطلبات القريبة + البطاقة والرحلة والأوسمة والحملات
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { getMyProfile, type Profile, supabase, toPoint } from "../../lib/supabase";
import { getCoords } from "../../lib/location";
import { registerPushToken } from "../../lib/push";
import { openDirections } from "../../lib/maps";
import { nextEligible } from "../../lib/donor";
import { fmt, getLang, useT } from "../../lib/i18n";
import { Button, C, Card, s, notify } from "../../lib/ui";

type Req = { request_id: string; facility_name: string; blood_type: string; units_left: number;
             urgency: "routine" | "urgent" | "critical"; distance_km: number; f_lat: number; f_lng: number };

function Tile({ label, to }: { label: string; to: string }) {
  return (
    <Pressable onPress={() => router.push(to as never)} style={[s.card, { flex: 1, minWidth: "45%", alignItems: "center", paddingVertical: 16 }]}>
      <Text style={[s.label, { fontSize: 15 }]}>{label}</Text>
    </Pressable>
  );
}

export default function Donor() {
  const t = useT();
  const [me, setMe] = useState<Profile | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, p] = await Promise.all([getCoords(), getMyProfile()]);
    if (c && p) await supabase.from("profiles").update({ location: toPoint(c.lat, c.lng) }).eq("id", p.id);
    if (p) registerPushToken(p.id);
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
    if (error) return notify("⚠️", error.code === "23505" ? t.alreadyResponded : error.message);
    notify("❤️", fmt(t.thanksResponded, { name: r.facility_name }));
  };

  const next = me ? nextEligible(me) : null;
  const urg = { routine: t.urg_routine, urgent: t.urg_urgent, critical: t.urg_critical };

  return (
    <FlatList
      style={s.screen} contentContainerStyle={s.pad} data={reqs} keyExtractor={(r) => r.request_id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListHeaderComponent={
        <View style={{ gap: 14 }}>
          <Card>
            <View style={s.row}>
              <Text style={s.h2}>{t.yourType}</Text>
              <Text style={[s.badge, { fontSize: 18 }]}>{me?.blood_type ?? "—"}</Text>
            </View>
            <Text style={[s.p, { color: next ? C.mute : C.ok }]}>
              {next ? fmt(t.eligibleAfter, { date: next.toLocaleDateString(getLang()) }) : t.eligibleNow}
            </Text>
            <View style={s.row}>
              <Text style={s.label}>{t.availableToggle}</Text>
              <Switch value={me?.available ?? false} onValueChange={toggle} trackColor={{ true: C.red }} />
            </View>
          </Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Tile label={t.myCard} to="/card" />
            <Tile label={t.myJourney} to="/journey" />
            <Tile label={t.myAchievements} to="/achievements" />
            <Tile label={t.campaigns} to="/campaigns" />
            <Tile label={t.myHealth} to="/health" />
            <Tile label={t.smartSchedule} to="/suggest" />
          </View>
          <Button title={t.nearestSites} onPress={() => router.push("/map")} />
          <Button title={t.askAgent} kind="ghost" onPress={() => router.push("/agent")} />
          <Text style={s.h2}>{fmt(t.nearbyRequests, { n: reqs.length })}</Text>
        </View>
      }
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListEmptyComponent={<Text style={s.p}>{t.noRequests}</Text>}
      renderItem={({ item }) => (
        <Card style={item.urgency === "critical" ? { borderColor: C.red } : undefined}>
          <View style={s.row}>
            <Text style={s.h2}>{item.facility_name}</Text>
            <Text style={s.badge}>{item.blood_type}</Text>
          </View>
          <Text style={s.p}>{urg[item.urgency]} · {fmt(t.unitsLeftKm, { u: item.units_left, km: item.distance_km })}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Button title={t.willDonate} onPress={() => respond(item)} disabled={!!next} /></View>
            <View style={{ flex: 1 }}><Button title={t.directions} kind="ghost" onPress={() => openDirections({ lat: item.f_lat, lng: item.f_lng })} /></View>
          </View>
        </Card>
      )}
    />
  );
}
