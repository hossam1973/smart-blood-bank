// خريطة جوجل (أندرويد) / خرائط النظام (iOS) — react-native-maps
// على الويب تُستخدم BloodMap.web.tsx (قائمة + روابط خرائط جوجل) لأن المكتبة لا تدعم الويب.
import { Platform, Text, View } from "react-native";
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { openDirections, regionFor, type Place } from "../lib/maps";
import { C } from "../lib/ui";

export type MapPin = Place & { id: string; title: string; subtitle?: string; color?: string };
export type DensityCell = { lat: number; lng: number; donors: number };

export default function BloodMap({ me, pins, density = [], height = 320 }: {
  me: Place | null; pins: MapPin[]; density?: DensityCell[]; height?: number;
}) {
  const center = me ?? { lat: 30.0444, lng: 31.2357 };
  const maxDonors = Math.max(1, ...density.map((d) => d.donors));
  return (
    <View style={{ height, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: C.line }}>
      <MapView
        style={{ flex: 1 }}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={regionFor([...pins, ...(me ? [me] : [])], center)}
        showsUserLocation={!!me}
        showsMyLocationButton
      >
        {density.map((d) => (
          // مناطق مجمّعة فقط — لا يظهر موقع أي متبرع بعينه
          <Circle key={`${d.lat},${d.lng}`} center={{ latitude: d.lat, longitude: d.lng }} radius={550}
            fillColor={`rgba(198,40,40,${0.12 + 0.45 * (d.donors / maxDonors)})`} strokeColor="rgba(198,40,40,0.4)" />
        ))}
        {pins.map((p) => (
          <Marker key={p.id} coordinate={{ latitude: p.lat, longitude: p.lng }} pinColor={p.color ?? C.red}
            title={p.title} description={`${p.subtitle ?? ""}${p.subtitle ? " · " : ""}اضغط للاتجاهات في خرائط جوجل`}
            onCalloutPress={() => openDirections(p)} />
        ))}
      </MapView>
      {density.length > 0 && (
        <Text style={{ position: "absolute", bottom: 6, right: 8, fontSize: 11, color: C.mute, backgroundColor: "#fffc", paddingHorizontal: 6, borderRadius: 6 }}>
          كثافة المتبرعين (مناطق مجمّعة، 3 متبرعين على الأقل)
        </Text>
      )}
    </View>
  );
}
