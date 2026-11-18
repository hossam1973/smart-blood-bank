// اختيار الدور + الفصيلة + الموقع
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { router } from "expo-router";
import { BLOOD_TYPES, type BloodType, ROLE_HOME, type Role, supabase, toPoint } from "../lib/supabase";
import { getCoords } from "../lib/location";
import { getLang, useT } from "../lib/i18n";
import { Button, Card, Chips, Field, s, notify } from "../lib/ui";

export default function Onboarding() {
  const t = useT();
  const ROLES: Record<string, Role> = { [t.roleDonor]: "donor", [t.roleBeneficiary]: "beneficiary", [t.roleStaff]: "facility_staff" };
  const SEXES: Record<string, "male" | "female"> = { [t.male]: "male", [t.female]: "female" };
  const [roleLabel, setRoleLabel] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [bt, setBt] = useState<BloodType | null>(null);
  const [sexLabel, setSexLabel] = useState<string | null>(null);

  const save = async () => {
    const role = roleLabel ? ROLES[roleLabel] : null;
    if (!role || !name.trim()) return notify(t.completeData);
    const coords = await getCoords();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").insert({
      id: user!.id, role, full_name: name.trim(), blood_type: bt, phone: user!.phone ? `+${user!.phone.replace(/^\+/, "")}` : null,
      sex: sexLabel ? SEXES[sexLabel] : null, lang: getLang(),
      location: coords ? toPoint(coords.lat, coords.lng) : null,
    });
    if (error) return notify(t.error, error.message);
    if (role === "facility_staff") notify("ℹ️", t.staffPending);
    router.replace(ROLE_HOME[role] as never);
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <Text style={s.h2}>{t.iAm}</Text>
        <Chips options={Object.keys(ROLES)} value={roleLabel} onChange={setRoleLabel} />
      </Card>
      <Card>
        <Field label={t.name} value={name} onChangeText={setName} />
        <Text style={s.label}>{roleLabel === t.roleDonor ? t.bloodType : t.bloodTypePatient}</Text>
        <Chips options={BLOOD_TYPES} value={bt} onChange={setBt} />
        <Text style={s.label}>{t.sex}</Text>
        <Chips options={Object.keys(SEXES)} value={sexLabel} onChange={setSexLabel} />
      </Card>
      <Text style={s.p}>{t.locationPrivacy}</Text>
      <Button title={t.saveContinue} onPress={save} />
    </ScrollView>
  );
}
