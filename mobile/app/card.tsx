// بطاقة المتبرع الرقمية — رمز QR يحمل معرّف المتبرع فقط (البيانات تُقرأ من الخادم بصلاحية الموظف وتُسجَّل في سجل التدقيق)
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { getMyProfile, type Profile } from "../lib/supabase";
import { fmt, getLang, useT } from "../lib/i18n";
import { nextEligible, QR_PREFIX } from "../lib/donor";
import { C, Card, s } from "../lib/ui";

export default function DonorCard() {
  const t = useT();
  const [me, setMe] = useState<Profile | null>(null);
  useEffect(() => { getMyProfile().then(setMe); }, []);
  if (!me) return <View style={s.screen} />;
  const next = nextEligible(me);
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { alignItems: "stretch" }]}>
      <Card style={{ alignItems: "center", gap: 12, borderColor: C.red, borderWidth: 2 }}>
        <Text style={s.h2}>{t.appName}</Text>
        <Text style={s.h1}>{me.full_name}</Text>
        <Text style={[s.badge, { fontSize: 26, paddingHorizontal: 18 }]}>{me.blood_type ?? "—"}</Text>
        <View style={{ padding: 12, backgroundColor: "#fff", borderRadius: 12 }}>
          <QRCode value={QR_PREFIX + me.id} size={200} color={C.ink} />
        </View>
        <Text style={[s.label, { color: next ? C.mute : C.ok }]}>
          {next ? fmt(t.eligibleAfter, { date: next.toLocaleDateString(getLang()) }) : t.eligibleNow}
        </Text>
        <Text style={s.p}>{t.lastDonation}: {me.last_donation_at ?? "—"}</Text>
      </Card>
      <Text style={s.p}>{t.cardHint}</Text>
    </ScrollView>
  );
}
