import { useEffect } from "react";
import { I18nManager } from "react-native";
import { Pressable, Text } from "react-native";
import { Stack, router } from "expo-router";
import { useT } from "../lib/i18n";
import * as Updates from "expo-updates";

function ForecastHeaderButton() {
  const t = useT();
  return (
    <Pressable onPress={() => router.push("/forecast")} hitSlop={8}>
      <Text style={{ color: "#C62828", fontWeight: "700" }}>📈 {t.forecastBtn}</Text>
    </Pressable>
  );
}

export default function RootLayout() {
  // تفعيل الاتجاه من اليمين لليسار للواجهة العربية (يحتاج إعادة تشغيل مرة واحدة)
  useEffect(() => {
    if (!I18nManager.isRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);
      Updates.reloadAsync().catch(() => {});
    }
  }, []);

  return (
    <Stack screenOptions={{ headerTitleAlign: "center", headerTintColor: "#C62828" }}>
      <Stack.Screen name="index" options={{ title: "بنك الدم الذكي" }} />
      <Stack.Screen name="onboarding" options={{ title: "إكمال الحساب" }} />
      <Stack.Screen name="donor/index" options={{ title: "بوابة المتبرع" }} />
      <Stack.Screen name="beneficiary/index" options={{ title: "بوابة المستفيد" }} />
      <Stack.Screen name="facility/index" options={{ title: "بوابة المنشأة", headerRight: () => <ForecastHeaderButton /> }} />
      <Stack.Screen name="forecast" options={{ title: "AI Inventory", presentation: "modal" }} />
      <Stack.Screen name="agent" options={{ title: "المساعد الذكي" }} />
    </Stack>
  );
}
