// مسح بطاقة المتبرع (QR) — للموظف: يعرض الأهلية ويسجّل التبرع ويصدر رمز الكيس
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { supabase } from "../lib/supabase";
import { QR_PREFIX } from "../lib/donor";
import { fmt, useT } from "../lib/i18n";
import { Button, C, Card, s, notify } from "../lib/ui";

type Info = { name: string; blood_type: string; eligible: boolean; last_donation: string | null; next_eligible: string | null; donations: number };

export default function Scan() {
  const t = useT();
  const [perm, request] = useCameraPermissions();
  const [donorId, setDonorId] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);

  const onScan = async ({ data }: { data: string }) => {
    if (busy || donorId || !data.startsWith(QR_PREFIX)) return;
    const id = data.slice(QR_PREFIX.length);
    setBusy(true); setDonorId(id);
    const { data: d, error } = await supabase.rpc("staff_lookup_donor", { p_donor: id });
    setBusy(false);
    if (error) { notify("⚠️", error.message); setDonorId(null); return; }
    setInfo(d as Info);
  };

  const record = async () => {
    setBusy(true);
    const { data: code, error } = await supabase.rpc("record_donation", { p_donor: donorId });
    setBusy(false);
    if (error) return notify("⚠️", error.message);
    notify("✅", fmt(t.donationRecorded, { code: String(code) }));
    setDonorId(null); setInfo(null);
  };

  if (!perm) return <View style={s.screen} />;
  if (!perm.granted) return (
    <View style={[s.screen, s.pad]}>
      <Text style={s.p}>{t.cameraDenied}</Text>
      <Button title={t.grantCamera} onPress={request} />
    </View>
  );

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      {!info && (
        <>
          <View style={{ height: 320, borderRadius: 14, overflow: "hidden" }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScan} />
          </View>
          <Text style={s.p}>{t.scanHint}</Text>
        </>
      )}
      {info && (
        <Card style={{ borderColor: info.eligible ? C.ok : C.red, borderWidth: 2 }}>
          <View style={s.row}><Text style={s.h2}>{info.name}</Text><Text style={[s.badge, { fontSize: 18 }]}>{info.blood_type}</Text></View>
          <Text style={[s.label, { color: info.eligible ? C.ok : C.red }]}>{info.eligible ? t.eligible : t.notEligible}</Text>
          <Text style={s.p}>{t.lastDonation}: {info.last_donation ?? "—"} · {t.nextEligible}: {info.next_eligible ?? "—"}</Text>
          <Text style={s.p}>{fmt(t.donationsCount, { n: info.donations })}</Text>
          <Button title={t.recordDonation} onPress={record} disabled={!info.eligible || busy} />
          <Button title={t.cancel} kind="ghost" onPress={() => { setInfo(null); setDonorId(null); }} />
        </Card>
      )}
    </ScrollView>
  );
}
