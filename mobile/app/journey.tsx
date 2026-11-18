// رحلة الكيس: كل تبرع ومراحله (سُحب ← فحص ← جاهز ← صُرف ← أنقذ حياة) — بدون أي بيانات عن المريض
import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { getLang, useT } from "../lib/i18n";
import { C, Card, s } from "../lib/ui";

type Ev = { status: string; at: string };
type Donation = { id: string; bag_code: string; blood_type: string; status: string; collected_at: string; donation_events: Ev[] };
const STEPS = ["collected", "testing", "ready", "issued", "transfused"] as const;

export default function Journey() {
  const t = useT();
  const [items, setItems] = useState<Donation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("donations").select("id,bag_code,blood_type,status,collected_at,donation_events(status,at)")
      .order("collected_at", { ascending: false });
    setItems((data ?? []) as Donation[]); setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const label = (st: string) => (t as Record<string, string>)[`j_${st}`] ?? st;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {items?.length === 0 && <Text style={s.p}>{t.journeyEmpty}</Text>}
      {items?.map((d) => {
        const reached = new Map(d.donation_events.map((e) => [e.status, e.at]));
        const discarded = d.status === "discarded";
        return (
          <Card key={d.id}>
            <View style={s.row}>
              <Text style={s.h2}>{new Date(d.collected_at).toLocaleDateString(getLang())}</Text>
              <Text style={s.badge}>{d.blood_type}</Text>
            </View>
            <Text style={[s.p, { fontSize: 12 }]}>{t.bagCode}: {d.bag_code}</Text>
            {(discarded ? (["collected", "testing", "discarded"] as string[]) : [...STEPS]).map((st, i, arr) => {
              const at = reached.get(st);
              const done = !!at;
              return (
                <View key={st} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                  <View style={{ alignItems: "center" }}>
                    <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: done ? (st === "transfused" ? C.ok : C.red) : C.line }} />
                    {i < arr.length - 1 && <View style={{ width: 2, height: 22, backgroundColor: done ? C.red : C.line }} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.label, { color: done ? C.ink : C.mute }]}>{label(st)}</Text>
                    {at && <Text style={[s.p, { fontSize: 12 }]}>{new Date(at).toLocaleString(getLang())}</Text>}
                  </View>
                </View>
              );
            })}
          </Card>
        );
      })}
      <Text style={[s.p, { fontSize: 12 }]}>{t.journeyHint}</Text>
    </ScrollView>
  );
}
