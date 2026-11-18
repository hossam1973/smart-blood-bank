// نافذة منبثقة للتنبؤ بالمخزون — تُفتح من زر الهيدر في أي وقت
import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { getMyProfile } from "../lib/supabase";
import ShortageForecast from "../components/ShortageForecast";
import { s } from "../lib/ui";
import { useT } from "../lib/i18n";

export default function ForecastModal() {
  const t = useT();
  const [fid, setFid] = useState<string | null | undefined>(undefined);
  useEffect(() => { getMyProfile().then((p) => setFid(p?.facility_id ?? null)); }, []);
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      {fid ? <ShortageForecast facilityId={fid} />
        : fid === null ? <Text style={s.p}>{t.notLinked}</Text> : null}
    </ScrollView>
  );
}
