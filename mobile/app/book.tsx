// حجز موعد تبرع — الأيام السبعة القادمة، والتحقق من الأهلية والسعة يتم في قاعدة البيانات (book_donation)
import { useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../lib/supabase";
import { fmt, getLang, useT } from "../lib/i18n";
import { Button, Card, Chips, s, notify } from "../lib/ui";

const HOURS = ["09:00", "11:00", "13:00", "16:00", "18:00", "20:00"];

export default function Book() {
  const t = useT();
  const { facility, name } = useLocalSearchParams<{ facility: string; name: string }>();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + (i + 1) * 864e5);
    return { key: d.toISOString().slice(0, 10), label: d.toLocaleDateString(getLang(), { weekday: "short", day: "numeric", month: "short" }) };
  }), []);
  const [day, setDay] = useState<string | null>(days[0].label);
  const [hour, setHour] = useState<string | null>("11:00");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    const d = days.find((x) => x.label === day);
    if (!d || !hour) return;
    setBusy(true);
    const { error } = await supabase.rpc("book_donation", { p_facility: facility, p_slot: new Date(`${d.key}T${hour}:00`).toISOString() });
    setBusy(false);
    if (error) {
      const m = error.message;
      const msg = m.includes("appointments_one_active_per_donor") ? t.errDuplicate : m.includes("not eligible") ? t.errNotEligible
        : m.includes("day is full") ? t.errFull : m.includes("not accepting") ? t.errNotAccepting : m;
      return notify(t.bookFail, msg);
    }
    notify("❤️", fmt(t.booked, { name: name ?? "", day: d.label, hour }));
    router.back();
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>{name}</Text>
      <Card><Text style={s.label}>{t.day}</Text><Chips options={days.map((d) => d.label)} value={day} onChange={setDay} /></Card>
      <Card><Text style={s.label}>{t.hour}</Text><Chips options={HOURS} value={hour} onChange={setHour} /></Card>
      <Text style={s.p}>{t.bookHint}</Text>
      <Button title={t.bookConfirm} onPress={confirm} disabled={busy || !day || !hour} />
    </ScrollView>
  );
}
