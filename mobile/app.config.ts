// يكمّل app.json بمفتاح خرائط جوجل من متغير البيئة GOOGLE_MAPS_API_KEY (لا يُكتب المفتاح في الكود)
import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return {
    ...(config as ExpoConfig),
    android: { ...config.android, config: { ...config.android?.config, googleMaps: { apiKey: key } } },
    ios: { ...config.ios, config: { ...config.ios?.config, googleMapsApiKey: key } },
  };
};
