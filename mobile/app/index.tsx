// تسجيل الدخول برقم الهاتف (OTP) ثم التوجيه لبوابة الدور
import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { router } from "expo-router";
import { ROLE_HOME, getMyProfile, supabase } from "../lib/supabase";
import { setLang, useT } from "../lib/i18n";
import { Button, Card, Field, s, notify } from "../lib/ui";

export default function Login() {
  const t = useT();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const route = async () => {
    const p = await getMyProfile();
    if (p?.lang) await setLang(p.lang as never); // لغة الحساب تتبع المستخدم على أي جهاز
    router.replace((p ? ROLE_HOME[p.role] : "/onboarding") as never);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) route(); });
  }, []);

  const send = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) return notify(t.error, error.message);
    setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
    setBusy(false);
    if (error) return notify(t.wrongCode, error.message);
    route();
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>{t.loginTagline}</Text>
      <Text style={s.p}>{t.loginSub}</Text>
      <Card>
        <Field label={t.phone} placeholder="+20 1XX XXX XXXX" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        {sent && <Field label={t.otpCode} keyboardType="number-pad" value={code} onChangeText={setCode} />}
        <Button title={sent ? t.verifyCode : t.sendCode} onPress={sent ? verify : send} disabled={busy || !phone} />
      </Card>
    </ScrollView>
  );
}
