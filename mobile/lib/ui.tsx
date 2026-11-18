import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";

export const C = { red: "#C62828", redSoft: "#FDECEC", ink: "#1B1B1F", mute: "#6B6B76", line: "#E6E6EA", bg: "#FAFAFB", ok: "#2E7D32" };

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({ title, onPress, kind = "primary", disabled }: {
  title: string; onPress: () => void; kind?: "primary" | "ghost"; disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={({ pressed }) => [s.btn, kind === "ghost" && s.btnGhost, (pressed || disabled) && { opacity: 0.6 }]}>
      <Text style={[s.btnText, kind === "ghost" && { color: C.red }]}>{title}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{props.label}</Text>
      <TextInput placeholderTextColor={C.mute} {...props} style={[s.input, props.style]} />
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: T[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <View style={s.chips}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={[s.chip, value === o && s.chipOn]}>
          <Text style={[s.chipText, value === o && { color: "#fff" }]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16, gap: 14 },
  h1: { fontSize: 24, fontWeight: "700", color: C.ink, textAlign: "right" },
  h2: { fontSize: 17, fontWeight: "700", color: C.ink, textAlign: "right" },
  p: { fontSize: 15, color: C.mute, textAlign: "right", lineHeight: 22 },
  label: { fontSize: 14, color: C.ink, textAlign: "right", fontWeight: "600" },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: C.line },
  btn: { backgroundColor: C.red, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  btnGhost: { backgroundColor: C.redSoft },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, fontSize: 16, backgroundColor: "#fff", textAlign: "right" },
  chips: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" },
  chipOn: { backgroundColor: C.red, borderColor: C.red },
  chipText: { fontWeight: "700", color: C.ink },
  row: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  badge: { backgroundColor: C.redSoft, color: C.red, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, fontWeight: "700", overflow: "hidden" },
});
