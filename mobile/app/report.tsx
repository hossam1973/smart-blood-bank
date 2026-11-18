// التقرير اليومي للمنشأة — يُولَّد مرة يوميًا بلغة المستخدم (الوكيل الذكي أو ملخص تلقائي)
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text } from "react-native";
import { supabase } from "../lib/supabase";
import { getLang, useT } from "../lib/i18n";
import { Button, C, Card, s } from "../lib/ui";

export default function Report() {
  const t = useT();
  const [rep, setRep] = useState<{ content: string; data: { source?: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (refresh = false) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("daily-report", { body: { lang: getLang(), refresh } });
    setBusy(false);
    if (!error && data?.content) setRep(data);
  };
  useEffect(() => { load(); }, []);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      {busy && <ActivityIndicator color={C.red} />}
      {rep && (
        <Card>
          <Text style={s.badge}>{rep.data?.source === "ai" ? t.reportAi : t.reportTemplate}</Text>
          <Text style={[s.p, { color: C.ink, lineHeight: 24 }]}>{rep.content}</Text>
        </Card>
      )}
      <Button title={t.regenerate} kind="ghost" onPress={() => load(true)} disabled={busy} />
    </ScrollView>
  );
}
