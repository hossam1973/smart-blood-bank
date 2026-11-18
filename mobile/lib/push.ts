// تسجيل رمز الإشعارات وحفظه في الملف الشخصي — بدونه لا يصل "النداء الفوري" لأي متبرع
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

export async function registerPushToken(userId: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("urgent", {
        name: "نداءات الدم العاجلة", importance: Notifications.AndroidImportance.MAX, sound: "default",
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    const status = existing === "granted" ? existing : (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await supabase.from("profiles").update({ push_token: token }).eq("id", userId);
    return token;
  } catch {
    return null; // المحاكي أو Expo Go بدون projectId — يعمل التطبيق بدون إشعارات
  }
}
