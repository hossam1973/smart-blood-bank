// بوابة المستفيد: البحث عن مخزون متوافق قريب + إنشاء طلب + متابعة طلباتي
import { useEffect, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { BLOOD_TYPES, type BloodType, supabase } from "../../lib/supabase";
import { getCoords } from "../../lib/location";
import { openDirections } from "../../lib/maps";
import { fmt, useT } from "../../lib/i18n";
import { Button, Card, Chips, Field, s, notify } from "../../lib/ui";

type Stock = { facility_id: string; facility_name: string; phone: string | null; blood_type: string; units: number; distance_km: number; f_lat: number; f_lng: number };
type MyReq = { id: string; blood_type: string; units_needed: number; units_secured: number; status: string };

export default function Beneficiary() {
  const t = useT();
  const [bt, setBt] = useState<BloodType | null>(null);
  const [stock, setStock] = useState<Stock[] | null>(null);
  const [units, setUnits] = useState("1");
  const [mine, setMine] = useState<MyReq[]>([]);

  const loadMine = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase.from("blood_requests").select("id,blood_type,units_needed,units_secured,status")
      .eq("requester_id", user?.id ?? "").order("created_at", { ascending: false }).limit(10);
    setMine((data ?? []) as MyReq[]);
  };
  useEffect(() => { loadMine(); }, []);

  const search = async () => {
    if (!bt) return;
    const c = await getCoords();
    if (!c) return notify(t.enableLocation, t.enableLocationMsg);
    const { data, error } = await supabase.rpc("find_inventory_nearby", { p_blood_type: bt, p_component: "rbc", lat: c.lat, lng: c.lng, radius_km: 30 });
    if (error) return notify(t.error, error.message);
    setStock((data ?? []) as Stock[]);
  };

  const request = async (f: Stock) => {
    const { data: { user } } = await supabase.auth.getUser();
    const n = Math.max(1, Math.min(20, parseInt(units) || 1));
    const { error } = await supabase.from("blood_requests").insert({ requester_id: user!.id, facility_id: f.facility_id, blood_type: bt, units_needed: n, urgency: "urgent" });
    if (error) return notify(t.error, error.message);
    notify("✅", fmt(t.requestSent, { name: f.facility_name }));
    loadMine();
  };
  const status = (st: string) => (t as unknown as Record<string, string>)[`st_${st}`] ?? st;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <Text style={s.h2}>{t.patientType}</Text>
        <Chips options={BLOOD_TYPES} value={bt} onChange={setBt} />
        <Field label={t.unitsNeeded} keyboardType="number-pad" value={units} onChangeText={setUnits} />
        <Button title={t.findStock} onPress={search} disabled={!bt} />
      </Card>

      {stock && (stock.length === 0 ? <Text style={s.p}>{t.noStock}</Text> : stock.map((x) => (
        <Card key={x.facility_id + x.blood_type}>
          <View style={s.row}><Text style={s.h2}>{x.facility_name}</Text><Text style={s.badge}>{x.blood_type}</Text></View>
          <Text style={s.p}>{fmt(t.unitsAvailableKm, { u: x.units, km: x.distance_km })}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Button title={t.requestHere} onPress={() => request(x)} /></View>
            <View style={{ flex: 1 }}><Button title={t.directions} kind="ghost" onPress={() => openDirections({ lat: x.f_lat, lng: x.f_lng })} /></View>
            {x.phone && <View style={{ flex: 1 }}><Button title={t.call} kind="ghost" onPress={() => Linking.openURL(`tel:${x.phone}`)} /></View>}
          </View>
        </Card>
      )))}

      <Button title={t.showOnMap} kind="ghost" onPress={() => router.push({ pathname: "/map", params: bt ? { bt } : {} })} />
      <Button title={t.askAgent} kind="ghost" onPress={() => router.push("/agent")} />

      <Text style={s.h2}>{t.myRequests}</Text>
      {mine.map((r) => (
        <Card key={r.id}>
          <View style={s.row}><Text style={s.label}>{status(r.status)}</Text><Text style={s.badge}>{r.blood_type}</Text></View>
          <Text style={s.p}>{fmt(t.securedOf, { s: r.units_secured, n: r.units_needed })}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}
