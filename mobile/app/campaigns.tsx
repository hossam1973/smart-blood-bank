// حملات التبرع للشركات: المتبرع يرى الحملات النشطة وينضم برمز الحملة
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { fmt, getLang, useT } from "../lib/i18n";
import { Button, Card, Field, s, notify } from "../lib/ui";

type Campaign = { id: string; title: string; org_name: string; address: string | null; starts_at: string; ends_at: string; target_donors: number; join_code: string };

export default function Campaigns() {
  const t = useT();
  const [list, setList] = useState<Campaign[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [code, setCode] = useState("");

  const load = async () => {
    const [{ data: c }, { data: m }] = await Promise.all([
      supabase.from("campaigns").select("id,title,org_name,address,starts_at,ends_at,target_donors,join_code")
        .eq("status", "active").gt("ends_at", new Date().toISOString()).order("starts_at"),
      supabase.from("campaign_signups").select("campaign_id"),
    ]);
    setList((c ?? []) as Campaign[]);
    setMine(new Set((m ?? []).map((x: { campaign_id: string }) => x.campaign_id)));
  };
  useEffect(() => { load(); }, []);

  const join = async (joinCode: string) => {
    const { error } = await supabase.rpc("join_campaign", { p_code: joinCode });
    if (error) return notify(t.error, error.message.includes("not found") ? t.campaignNotFound : error.message);
    notify("✅", t.joined); setCode(""); load();
  };
  const when = (d: string) => new Date(d).toLocaleString(getLang(), { dateStyle: "medium", timeStyle: "short" });

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <Field label={t.joinCode} value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="AB12CD" />
        <Button title={t.join} onPress={() => join(code)} disabled={code.trim().length < 4} />
      </Card>
      {list.length === 0 && <Text style={s.p}>{t.noCampaigns}</Text>}
      {list.map((c) => (
        <Card key={c.id}>
          <Text style={s.h2}>{c.title}</Text>
          <Text style={s.label}>{c.org_name}</Text>
          {c.address ? <Text style={s.p}>{c.address}</Text> : null}
          <Text style={s.p}>{t.starts}: {when(c.starts_at)} · {t.ends}: {when(c.ends_at)}</Text>
          <View style={s.row}>
            <Text style={s.p}>{fmt(t.campaignTarget, { n: c.target_donors })}</Text>
            {mine.has(c.id) ? <Text style={s.badge}>✓</Text> : <Button title={t.join} onPress={() => join(c.join_code)} />}
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
