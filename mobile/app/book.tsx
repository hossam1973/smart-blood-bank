// حجز موعد تبرع — الأيام السبعة القادمة، والتحقق من الأهلية والسعة يتم في قاعدة البيانات (book_donation)
import { useMemo, useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../lib/supabase";
import { Button, Card, Chips, s } from "../lib/ui";

const HOURS = ["09:00", "11:00", "13:00", "16:00", "18:00", "20:00"];
const ERR: Record<string, string> = {
  "not eligible yet": "لم يحن موعد أهليتك للتبرع بعد.",
  "day is full": "هذا اليوم ممتلئ، اختر يومًا آخر.",
  "facility not accepting donations": "هذا المكان لا يستقبل متبرعين حاليًا.",
};

export default function Book() {
  const { facility, name } = useLocalSearchParams<{ facility: string; name: string }>();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + (i + 1) * 864e5);
    return { key: d.toISOString().slice(0, 10), label: d.toLocaleDateString("ar-EG", { weekday: "short", day: "numeric", month: "short" }) };
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
      const known = Object.keys(ERR).find((k) => error.message.includes(k));
      const dup = error.message.includes("appointments_one_active_per_donor");
      return Alert.alert("تعذّر الحجز", dup ? "لديك موعد محجوز بالفعل." : known ? ERR[known] : error.message);
    }
    Alert.alert("تم الحجز ❤️", `موعدك في ${name} يوم ${d.label} الساعة ${hour}. أحضر بطاقة الهوية، واشرب 500 مل ماء قبل الموعد بنصف ساعة، وتناول وجبة خفيفة.`);
    router.back();
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>{name}</Text>
      <Card><Text style={s.label}>اليوم</Text><Chips options={days.map((d) => d.label)} value={day} onChange={setDay} /></Card>
      <Card><Text style={s.label}>الساعة</Text><Chips options={HOURS} value={hour} onChange={setHour} /></Card>
      <Text style={s.p}>تبرعك يستغرق حوالي 45 دقيقة، منها 10 دقائق فقط لسحب الدم. يمكن أن تنقذ وحدة واحدة حتى 3 أرواح.</Text>
      <Button title="تأكيد الحجز" onPress={confirm} disabled={busy || !day || !hour} />
    </ScrollView>
  );
}
