// الأوسمة والتحديات وأبطال الأسبوع — تقدير غير مالي (التبرع تطوعي)
import { useEffect, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { getMyProfile, supabase } from "../lib/supabase";
import { fmt, useT } from "../lib/i18n";
import { C, Card, s } from "../lib/ui";

type Ach = { donations: number; lives_estimate: number; points: number; badges: string[]; next_badge_at: number | null;
  challenges: { id: string; done: boolean; progress: number; goal: number; points: number }[] };
const ALL_BADGES = ["first_donation", "hero_5", "super_10", "legend_15", "rare_blood", "emergency_responder"];
const ICON: Record<string, string> = { first_donation: "🩸", hero_5: "🦸", super_10: "⚡", legend_15: "👑", rare_blood: "💎", emergency_responder: "🚑" };

export default function Achievements() {
  const t = useT() as unknown as Record<string, string> & ReturnType<typeof useT>;
  const [a, setA] = useState<Ach | null>(null);
  const [heroes, setHeroes] = useState<{ rank: number; display_name: string; points: number }[]>([]);
  const [onBoard, setOnBoard] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => { (async () => {
    const [{ data: ach }, { data: h }, p] = await Promise.all([supabase.rpc("my_achievements"), supabase.rpc("hero_of_week"), getMyProfile()]);
    setA(ach as Ach); setHeroes(h ?? []); setOnBoard(!!p?.show_on_leaderboard); setUid(p?.id ?? null);
  })(); }, []);

  const toggleBoard = async (v: boolean) => {
    setOnBoard(v);
    if (uid) await supabase.from("profiles").update({ show_on_leaderboard: v }).eq("id", uid);
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {[[t.donationsTotal, a?.donations], [t.livesSaved, a?.lives_estimate], [t.points, a?.points]].map(([l, v]) => (
          <Card key={String(l)} style={{ flex: 1, alignItems: "center" }}>
            <Text style={[s.h1, { color: C.red }]}>{v ?? "—"}</Text>
            <Text style={[s.p, { fontSize: 12, textAlign: "center" }]}>{l}</Text>
          </Card>
        ))}
      </View>

      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {ALL_BADGES.map((b) => {
            const has = a?.badges.includes(b);
            return (
              <View key={b} style={{ width: "30%", alignItems: "center", opacity: has ? 1 : 0.3, gap: 4 }}>
                <Text style={{ fontSize: 34 }}>{ICON[b]}</Text>
                <Text style={[s.label, { fontSize: 12, textAlign: "center" }]}>{t[`b_${b}`]}</Text>
              </View>
            );
          })}
        </View>
        {a?.next_badge_at ? <Text style={s.p}>{fmt(t.nextBadge, { n: a.next_badge_at })}</Text> : null}
      </Card>

      <Card>
        <Text style={s.h2}>{t.challenges}</Text>
        {a?.challenges.map((c) => (
          <View key={c.id} style={[s.row, { paddingVertical: 6 }]}>
            <Text style={[s.label, { flex: 1, color: c.done ? C.ok : C.ink }]}>{c.done ? "✅ " : "⬜ "}{t[`ch_${c.id}`]}</Text>
            <Text style={s.badge}>+{c.points}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={s.h2}>{t.heroOfWeek}</Text>
        {heroes.length === 0 ? <Text style={s.p}>{t.noHeroes}</Text> : heroes.map((h) => (
          <View key={h.rank} style={[s.row, { paddingVertical: 4 }]}>
            <Text style={s.label}>{["🥇", "🥈", "🥉"][h.rank - 1] ?? `#${h.rank}`} {h.display_name}</Text>
            <Text style={s.p}>{fmt(t.pointsN, { n: h.points })}</Text>
          </View>
        ))}
        <View style={s.row}>
          <Text style={[s.p, { flex: 1 }]}>{t.showOnBoard}</Text>
          <Switch value={onBoard} onValueChange={toggleBoard} trackColor={{ true: C.red }} />
        </View>
      </Card>
    </ScrollView>
  );
}
