import { useEffect } from "react";
import { Pressable, Text } from "react-native";
import { Stack, router } from "expo-router";
import { initLang, useT } from "../lib/i18n";
import { C } from "../lib/ui";

function HeaderLink({ label, to }: { label: string; to: string }) {
  return (
    <Pressable onPress={() => router.push(to as never)} hitSlop={8}>
      <Text style={{ color: C.red, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

export default function RootLayout() {
  const t = useT();
  useEffect(() => { initLang(); }, []);

  const settings = () => <HeaderLink label="⚙️" to="/settings" />;
  return (
    <Stack screenOptions={{ headerTitleAlign: "center", headerTintColor: C.red }}>
      <Stack.Screen name="index" options={{ title: t.appName, headerRight: () => <HeaderLink label="🌐" to="/settings" /> }} />
      <Stack.Screen name="onboarding" options={{ title: t.tOnboarding }} />
      <Stack.Screen name="donor/index" options={{ title: t.tDonor, headerRight: settings }} />
      <Stack.Screen name="beneficiary/index" options={{ title: t.tBeneficiary, headerRight: settings }} />
      <Stack.Screen name="facility/index" options={{ title: t.tFacility, headerRight: () => <HeaderLink label={`📈 ${t.forecastBtn}`} to="/forecast" /> }} />
      <Stack.Screen name="admin/index" options={{ title: t.tAdmin, headerRight: settings }} />
      <Stack.Screen name="forecast" options={{ title: t.tForecast, presentation: "modal" }} />
      <Stack.Screen name="agent" options={{ title: t.tAgent }} />
      <Stack.Screen name="map" options={{ title: t.tMap }} />
      <Stack.Screen name="book" options={{ title: t.tBook }} />
      <Stack.Screen name="card" options={{ title: t.tCard }} />
      <Stack.Screen name="journey" options={{ title: t.tJourney }} />
      <Stack.Screen name="achievements" options={{ title: t.tAchievements }} />
      <Stack.Screen name="campaigns" options={{ title: t.tCampaigns }} />
      <Stack.Screen name="report" options={{ title: t.tReport }} />
      <Stack.Screen name="scan" options={{ title: t.tScan }} />
      <Stack.Screen name="settings" options={{ title: t.tSettings }} />
    </Stack>
  );
}
