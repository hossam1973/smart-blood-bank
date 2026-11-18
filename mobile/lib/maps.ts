// روابط خرائط جوجل — تعمل بدون مفتاح API (تفتح تطبيق Google Maps أو المتصفح)
import { Linking } from "react-native";

export type Place = { lat: number; lng: number; label?: string };

/** الاتجاهات من الموقع الحالي إلى المكان */
export const directionsUrl = (p: Place) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;

/** عرض المكان على الخريطة */
export const placeUrl = (p: Place) =>
  `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

export const openDirections = (p: Place) => Linking.openURL(directionsUrl(p));

/** المنطقة التي تحيط بمجموعة نقاط (لتوسيط الخريطة) */
export function regionFor(points: Place[], fallback: Place) {
  const pts = points.length ? points : [fallback];
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.04, (maxLat - minLat) * 1.5),
    longitudeDelta: Math.max(0.04, (maxLng - minLng) * 1.5),
  };
}
