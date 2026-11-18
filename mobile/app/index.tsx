// تسجيل الدخول برقم الهاتف (OTP) ثم التوجيه لبوابة الدور
import { useEffect, useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { router } from "expo-router";
import { ROLE_HOME, getMyProfile, supabase } from "../lib/supabase";
import { Button, Card, Field, s } from "../lib/ui";

export default function Login() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const route = async () => {
    const p = await getMyProfile();
    router.replace((p ? ROLE_HOME[p.role] : "/onboarding") as never);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) route(); });
  }, []);

  const send = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) return Alert.alert("خطأ", error.message);
    setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
    setBusy(false);
    if (error) return Alert.alert("رمز غير صحيح", error.message);
    route();
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.h1}>قطرة دم تنقذ حياة 🩸</Text>
      <Text style={s.p}>نربط المتبرعين والمرضى بالمستشفيات وبنوك الدم الأقرب إليك — في دقائق.</Text>
      <Card>
        <Field label="رقم الهاتف" placeholder="+20 1XX XXX XXXX" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        {sent && <Field label="رمز التحقق" keyboardType="number-pad" value={code} onChangeText={setCode} />}
        <Button title={sent ? "تأكيد الدخول" : "إرسال رمز التحقق"} onPress={sent ? verify : send} disabled={busy || !phone} />
      </Card>
    </ScrollView>
  );
}
