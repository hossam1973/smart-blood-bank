// المساعد الذكي للجدولة: أفضل مكان وموعد للتبرع حسب الأهلية والجاهزية واحتياج المستشفيات القريبة (suggest_donation_slots)
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { getCoords } from "../lib/location";
import { openDirections } from "../lib/maps";
import { fmt, getLang, useT } from "../lib/i18n";
import { Button, C, Card, notify, s } from "../lib/ui";

type Slot = { facility_id: string; name: string; distance_km: number; suggested_day: string; suggested_hour: number; score: number; reasons: string[]; f_lat: number; f_lng: number };

export default function Suggest() {
  const t = useT();
  const T = t as unknown as Record<string, string>;
  const [slots, setSlots] = useState<Slot[] | null>(null);

  useEffect(() => { (async () => {
    const c = await getCoords();
    if (!c) { notify(t.enableLocation, t.mapEnableLoc); setSlots([]); return; }
    const { data, error } = await supabase.rpc("suggest_donation_slots", { lat: c.lat, lng: c.lng, radius_km: 30 });
    if (error) notify(t.error, error.message);
    setSlots((data ?? []) as Slot[]);
  })(); }, []);

  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(getLang(), { weekday: "long", day: "numeric", month: "long" });

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.p}>{t.suggestHint}</Text>
      {!slots && <ActivityIndicator color={C.red} />}
      {slots?.length === 0 && <Text style={s.p}>{t.noSuggestions}</Text>}
      {slots?.map((x, i) => (
        <Card key={x.facility_id} style={i === 0 ? { borderColor: C.red, borderWidth: 2 } : undefined}>
          <View style={s.row}>
            <Text style={s.h2}>{i === 0 ? "⭐ " : ""}{x.name}</Text>
            <Text style={s.badge}>{x.distance_km} {t.km}</Text>
          </View>
          <Text style={[s.label, { color: C.red }]}>{fmt(t.dayAt, { d: day(x.suggested_day), h: x.suggested_hour })}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {x.reasons.map((r) => <Text key={r} style={[s.badge, { fontSize: 12 }]}>{T[`sr_${r}`] ?? r}</Text>)}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Button title={t.bookDonation} onPress={() => router.push({ pathname: "/book", params: { facility: x.facility_id, name: x.name } })} /></View>
            <View style={{ flex: 1 }}><Button title={t.directions} kind="ghost" onPress={() => openDirections({ lat: x.f_lat, lng: x.f_lng })} /></View>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
