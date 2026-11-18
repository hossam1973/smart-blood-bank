// نسخة الويب: react-native-maps لا تعمل في المتصفح، فنعرض الأماكن مرتبة مع زر "الاتجاهات في خرائط جوجل"
import { Linking, Pressable, Text, View } from "react-native";
import { directionsUrl, type Place } from "../lib/maps";
import { C, s } from "../lib/ui";

export type MapPin = Place & { id: string; title: string; subtitle?: string; color?: string };
export type DensityCell = { lat: number; lng: number; donors: number };

export default function BloodMap({ pins, density = [] }: { me: Place | null; pins: MapPin[]; density?: DensityCell[]; height?: number }) {
  return (
    <View style={{ gap: 8 }}>
      {pins.map((p) => (
        <View key={p.id} style={[s.card, { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{p.title}</Text>
            {p.subtitle ? <Text style={[s.p, { fontSize: 13 }]}>{p.subtitle}</Text> : null}
          </View>
          <Pressable onPress={() => Linking.openURL(directionsUrl(p))} style={[s.chip, { borderColor: C.red }]}>
            <Text style={[s.chipText, { color: C.red }]}>📍 الاتجاهات</Text>
          </Pressable>
        </View>
      ))}
      {density.length > 0 && (
        <Text style={s.p}>
          متبرعون مؤهلون حولك: {density.reduce((a, d) => a + d.donors, 0)} في {density.length} منطقة (أعداد مجمّعة فقط).
        </Text>
      )}
    </View>
  );
}
