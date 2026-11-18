// بوابة المستفيد: البحث عن مخزون متوافق قريب + إنشاء طلب + متابعة طلباتي
import { useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { BLOOD_TYPES, type BloodType, supabase } from "../../lib/supabase";
import { getCoords } from "../../lib/location";
import { openDirections } from "../../lib/maps";
import { Button, Card, Chips, Field, s } from "../../lib/ui";

type Stock = { facility_id: string; facility_name: string; phone: string | null; blood_type: string; units: number; distance_km: number; f_lat: number; f_lng: number };
type MyReq = { id: string; blood_type: string; units_needed: number; units_secured: number; status: string };
const STATUS: Record<string, string> = { open: "مفتوح", matching: "جاري البحث", partially_fulfilled: "تم جزئيًا", fulfilled: "مكتمل ✅", cancelled: "ملغي", expired: "منتهي" };

export default function Beneficiary() {
  const [bt, setBt] = useState<BloodType | null>(null);
  const [stock, setStock] = useState<Stock[] | null>(null);
  const [units, setUnits] = useState("1");
  const [mine, setMine] = useState<MyReq[]>([]);

  const loadMine = async () => {
    const { data } = await supabase.from("blood_requests")
      .select("id,blood_type,units_needed,units_secured,status").order("created_at", { ascending: false }).limit(10);
    setMine((data ?? []) as MyReq[]);
  };
  useEffect(() => { loadMine(); }, []);

  const search = async () => {
    if (!bt) return;
    const c = await getCoords();
    if (!c) return Alert.alert("فعّل الموقع", "نحتاج موقعك لإيجاد أقرب مخزون.");
    const { data, error } = await supabase.rpc("find_inventory_nearby",
      { p_blood_type: bt, p_component: "rbc", lat: c.lat, lng: c.lng, radius_km: 30 });
    if (error) return Alert.alert("خطأ", error.message);
    setStock((data ?? []) as Stock[]);
  };

  const request = async (facility: Stock) => {
    const { data: { user } } = await supabase.auth.getUser();
    const n = Math.max(1, Math.min(20, parseInt(units) || 1));
    const { error } = await supabase.from("blood_requests").insert({
      requester_id: user!.id, facility_id: facility.facility_id, blood_type: bt, units_needed: n, urgency: "urgent" });
    if (error) return Alert.alert("خطأ", error.message);
    Alert.alert("تم إرسال الطلب", `سيتواصل معك ${facility.facility_name} للتأكيد، وسنُبلغ المتبرعين المتوافقين.`);
    loadMine();
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <Text style={s.h2}>فصيلة المريض</Text>
        <Chips options={BLOOD_TYPES} value={bt} onChange={setBt} />
        <Field label="عدد الوحدات المطلوبة" keyboardType="number-pad" value={units} onChangeText={setUnits} />
        <Button title="ابحث عن أقرب مخزون متوافق" onPress={search} disabled={!bt} />
      </Card>

      {stock && (stock.length === 0
        ? <Text style={s.p}>لا يوجد مخزون متوافق ضمن 30 كم. أنشئ طلبًا لدى أقرب مستشفى وسنطلق نداءً للمتبرعين.</Text>
        : stock.map((x) => (
          <Card key={x.facility_id + x.blood_type}>
            <View style={s.row}><Text style={s.h2}>{x.facility_name}</Text><Text style={s.badge}>{x.blood_type}</Text></View>
            <Text style={s.p}>{x.units} وحدة متاحة · {x.distance_km} كم</Text>
            <View style={{ flexDirection: "row-reverse", gap: 8 }}>
              <View style={{ flex: 1 }}><Button title="اطلب الآن" onPress={() => request(x)} /></View>
              <View style={{ flex: 1 }}><Button title="📍 الاتجاهات" kind="ghost" onPress={() => openDirections({ lat: x.f_lat, lng: x.f_lng })} /></View>
              {x.phone && <View style={{ flex: 1 }}><Button title="اتصال" kind="ghost" onPress={() => Linking.openURL(`tel:${x.phone}`)} /></View>}
            </View>
          </Card>
        )))}

      <Button title="🗺️ عرض المخزون على الخريطة" kind="ghost" onPress={() => router.push({ pathname: "/map", params: bt ? { bt } : {} })} />
      <Button title="اسأل المساعد الذكي" kind="ghost" onPress={() => router.push("/agent")} />

      <Text style={s.h2}>طلباتي</Text>
      {mine.map((r) => (
        <Card key={r.id}>
          <View style={s.row}><Text style={s.label}>{STATUS[r.status] ?? r.status}</Text><Text style={s.badge}>{r.blood_type}</Text></View>
          <Text style={s.p}>تم تأمين {r.units_secured} من {r.units_needed} وحدة</Text>
        </Card>
      ))}
    </ScrollView>
  );
}
