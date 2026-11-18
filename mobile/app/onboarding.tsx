// اختيار الدور + الفصيلة + الموقع
import { useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { router } from "expo-router";
import { BLOOD_TYPES, type BloodType, ROLE_HOME, type Role, supabase, toPoint } from "../lib/supabase";
import { getCoords } from "../lib/location";
import { Button, Card, Chips, Field, s } from "../lib/ui";

const ROLES: Record<string, Role> = { "متبرع": "donor", "مريض / مستفيد": "beneficiary", "موظف مستشفى / بنك دم": "facility_staff" };

export default function Onboarding() {
  const [roleLabel, setRoleLabel] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [bt, setBt] = useState<BloodType | null>(null);
  const [sex, setSex] = useState<"ذكر" | "أنثى" | null>(null);

  const save = async () => {
    const role = roleLabel ? ROLES[roleLabel] : null;
    if (!role || !name) return Alert.alert("أكمل البيانات");
    const coords = await getCoords();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").insert({
      id: user!.id, role, full_name: name, blood_type: bt, phone: user!.phone,
      sex: sex === "أنثى" ? "female" : sex === "ذكر" ? "male" : null,
      location: coords ? toPoint(coords.lat, coords.lng) : null,
    });
    if (error) return Alert.alert("خطأ", error.message);
    if (role === "facility_staff") Alert.alert("تنبيه", "سيتم ربط حسابك بالمنشأة بعد توثيقها من فريق المنصة.");
    router.replace(ROLE_HOME[role] as never);
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <Text style={s.h2}>أنا…</Text>
        <Chips options={Object.keys(ROLES)} value={roleLabel} onChange={setRoleLabel} />
      </Card>
      <Card>
        <Field label="الاسم" value={name} onChangeText={setName} />
        <Text style={s.label}>فصيلة الدم {roleLabel === "متبرع" ? "" : "(للمريض إن وُجدت)"}</Text>
        <Chips options={BLOOD_TYPES} value={bt} onChange={setBt} />
        <Text style={s.label}>النوع</Text>
        <Chips options={["ذكر", "أنثى"] as const as unknown as ("ذكر" | "أنثى")[]} value={sex} onChange={setSex} />
      </Card>
      <Text style={s.p}>نستخدم موقعك لحساب المسافة فقط، ولا يظهر موقعك الدقيق لأي مستخدم آخر.</Text>
      <Button title="حفظ ومتابعة" onPress={save} />
    </ScrollView>
  );
}
