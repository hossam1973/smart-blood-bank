// خريطة المنصة حسب الدور: متبرع (أماكن التبرع + الطلبات العاجلة)، مستفيد (أقرب مخزون متوافق)، منشأة (كثافة المتبرعين المجمّعة)
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import BloodMap, { type DensityCell, type MapPin } from "../components/BloodMap";
import { BLOOD_TYPES, type BloodType, getMyProfile, type Profile, supabase } from "../lib/supabase";
import { getCoords } from "../lib/location";
import { openDirections } from "../lib/maps";
import { fmt, useT } from "../lib/i18n";
import { Button, C, Card, Chips, s } from "../lib/ui";

type Row = { id: string; title: string; sub: string; lat: number; lng: number; facility_id?: string; donate?: boolean; urgent?: boolean };

export default function MapScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ bt?: string }>();
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bt, setBt] = useState<BloodType | null>((params.bt as BloodType) ?? null);
  const [rows, setRows] = useState<Row[]>([]);
  const [density, setDensity] = useState<DensityCell[]>([]);
  const [msg, setMsg] = useState(t.loading);

  useEffect(() => { (async () => {
    const [c, p] = await Promise.all([getCoords(), getMyProfile()]);
    setMe(c); setProfile(p);
    if (!c && p?.role !== "facility_staff") setMsg(t.mapEnableLoc);
  })(); }, []);

  useEffect(() => { (async () => {
    if (!profile) return;
    if (profile.role === "facility_staff") {
      const { data } = await supabase.rpc("donor_density_near_my_facility", { radius_km: 20 });
      setDensity((data ?? []).map((d: { cell_lat: number; cell_lng: number; donors: number }) => ({ lat: d.cell_lat, lng: d.cell_lng, donors: d.donors })));
      setMsg("");
      return;
    }
    if (!me) return;
    if (profile.role === "donor") {
      const [{ data: sites }, { data: reqs }] = await Promise.all([
        supabase.rpc("nearest_donation_sites", { lat: me.lat, lng: me.lng, radius_km: 30 }),
        supabase.rpc("open_requests_for_donor", { radius_km: 30 }),
      ]);
      const urgentAt = new Map((reqs ?? []).map((r: { facility_id: string; blood_type: string; units_left: number }) => [r.facility_id, r]));
      setRows((sites ?? []).map((x: { facility_id: string; name: string; hours: string | null; distance_km: number; f_lat: number; f_lng: number }) => {
        const r = urgentAt.get(x.facility_id) as { blood_type: string; units_left: number } | undefined;
        return { id: x.facility_id, facility_id: x.facility_id, donate: true, urgent: !!r, title: x.name, lat: x.f_lat, lng: x.f_lng,
          sub: `${x.distance_km} ${t.km}${x.hours ? ` · ${x.hours}` : ""}${r ? ` · ${fmt(t.needsNow, { t: r.blood_type, u: r.units_left })}` : ""}` };
      }));
      setMsg((sites ?? []).length ? "" : t.noSites);
    } else if (bt) {
      const { data } = await supabase.rpc("find_inventory_nearby", { p_blood_type: bt, p_component: "rbc", lat: me.lat, lng: me.lng, radius_km: 50 });
      const byFacility = new Map<string, Row>();
      for (const x of (data ?? []) as { facility_id: string; facility_name: string; blood_type: string; units: number; distance_km: number; f_lat: number; f_lng: number }[]) {
        const prev = byFacility.get(x.facility_id);
        const part = `${x.blood_type}: ${x.units}`;
        byFacility.set(x.facility_id, prev ? { ...prev, sub: `${prev.sub} · ${part}` }
          : { id: x.facility_id, facility_id: x.facility_id, title: x.facility_name, lat: x.f_lat, lng: x.f_lng, sub: `${x.distance_km} ${t.km} · ${part}` });
      }
      setRows([...byFacility.values()]);
      setMsg(byFacility.size ? "" : t.noStock);
    } else setMsg(t.chooseType);
  })(); }, [profile, me, bt]);

  const pins: MapPin[] = rows.map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, title: r.title, subtitle: r.sub, color: r.urgent ? C.red : "#1565C0" }));

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      {profile?.role === "beneficiary" && (
        <Card><Text style={s.label}>{t.patientType}</Text><Chips options={BLOOD_TYPES} value={bt} onChange={setBt} /></Card>
      )}
      <BloodMap me={me} pins={pins} density={density} />
      {msg ? <Text style={s.p}>{msg}</Text> : null}
      {profile?.role === "facility_staff" && density.length > 0 && (
        <Text style={s.p}>{fmt(t.densityInfo, { n: density.reduce((a, d) => a + d.donors, 0), c: density.length })}</Text>
      )}
      {rows.map((r) => (
        <Card key={r.id} style={r.urgent ? { borderColor: C.red } : undefined}>
          <Text style={s.h2}>{r.title}</Text>
          <Text style={s.p}>{r.sub}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Button title={t.openInMaps} kind="ghost" onPress={() => openDirections(r)} /></View>
            {r.donate && <View style={{ flex: 1 }}><Button title={t.bookDonation} onPress={() => router.push({ pathname: "/book", params: { facility: r.facility_id, name: r.title } })} /></View>}
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
