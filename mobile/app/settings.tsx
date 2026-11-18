// الإعدادات: اللغة (6 لغات) وتسجيل الخروج
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { LANGS, setLang, useLang, useT } from "../lib/i18n";
import { saveLangToProfile, supabase } from "../lib/supabase";
import { Button, C, Card, s } from "../lib/ui";

export default function Settings() {
  const t = useT();
  const lang = useLang();
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <Text style={s.h2}>{t.language}</Text>
        {LANGS.map((l) => (
          <Pressable key={l.code} onPress={() => setLang(l.code, saveLangToProfile)}
            style={[s.row, { paddingVertical: 10, borderTopWidth: 1, borderColor: C.line }]}>
            <Text style={[s.label, { fontSize: 16 }]}>{l.name}</Text>
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.red,
              backgroundColor: lang === l.code ? C.red : "transparent" }} />
          </Pressable>
        ))}
        <Text style={[s.p, { fontSize: 13 }]}>{t.languageHint}</Text>
      </Card>
      <Button title={t.signOut} kind="ghost" onPress={async () => { await supabase.auth.signOut(); router.replace("/"); }} />
    </ScrollView>
  );
}
