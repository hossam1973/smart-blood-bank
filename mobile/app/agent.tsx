// شاشة المحادثة مع الوكيل الذكي (يستدعي Edge Function: blood-agent)
import { useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";
import { getCoords } from "../lib/location";
import { Button, C, s } from "../lib/ui";

type Bubble = { me: boolean; text: string };
const SUGGEST = ["أين أجد دم O- قريب مني؟", "هل أستطيع التبرع الآن؟", "ما الفصائل المتوافقة مع A+؟"];

export default function Agent() {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    { me: false, text: "أهلًا، أنا رفيق 👋 أساعدك في إيجاد الدم، التبرع، ومتابعة الطلبات. بماذا أخدمك؟" },
  ]);
  // سجل المحادثة الكامل كما يعيده الخادم (يتضمن خطوات الأدوات) — يُعاد إرساله بلا تعديل
  const history = useRef<unknown[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (q = text) => {
    if (!q.trim() || busy) return;
    setText(""); setBusy(true);
    setBubbles((b) => [...b, { me: true, text: q }]);
    const coords = await getCoords();
    const messages = [...history.current, { role: "user", content: q }];
    const { data, error } = await supabase.functions.invoke("blood-agent", { body: { messages, ...coords } });
    if (error || !data?.reply) {
      setBubbles((b) => [...b, { me: false, text: "حدث خطأ في الاتصال. حاول مرة أخرى." }]);
    } else {
      if (data.messages) history.current = data.messages;
      setBubbles((b) => [...b, { me: false, text: data.reply }]);
    }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <FlatList
        data={bubbles} keyExtractor={(_, i) => String(i)} contentContainerStyle={{ padding: 16, gap: 10 }}
        renderItem={({ item }) => (
          <View style={{ alignSelf: item.me ? "flex-end" : "flex-start", maxWidth: "85%",
            backgroundColor: item.me ? C.red : "#fff", borderRadius: 14, padding: 12, borderWidth: item.me ? 0 : 1, borderColor: C.line }}>
            <Text style={{ color: item.me ? "#fff" : C.ink, fontSize: 15, lineHeight: 22, textAlign: "right" }}>{item.text}</Text>
          </View>
        )}
        ListFooterComponent={busy ? <ActivityIndicator color={C.red} /> : bubbles.length === 1 ? (
          <View style={{ gap: 8, marginTop: 8 }}>{SUGGEST.map((q) => <Button key={q} title={q} kind="ghost" onPress={() => send(q)} />)}</View>
        ) : null}
      />
      <View style={{ flexDirection: "row-reverse", gap: 8, padding: 12, borderTopWidth: 1, borderColor: C.line, backgroundColor: "#fff" }}>
        <TextInput value={text} onChangeText={setText} placeholder="اكتب سؤالك…" style={[s.input, { flex: 1 }]} onSubmitEditing={() => send()} />
        <View style={{ width: 90 }}><Button title="إرسال" onPress={() => send()} disabled={busy} /></View>
      </View>
    </KeyboardAvoidingView>
  );
}
