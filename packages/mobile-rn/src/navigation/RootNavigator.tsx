import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getSecureItem, secureStorageKeys } from "../lib/storage/secureStorage";
import { ConnectionModeScreen } from "../screens/ConnectionModeScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { RecentHostsScreen } from "../screens/RecentHostsScreen";
import { SearchHostsScreen } from "../screens/SearchHostsScreen";
import { SessionPlaceholderScreen } from "../screens/SessionPlaceholderScreen";
import { WelcomeScreen } from "../screens/WelcomeScreen";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import { useAppTheme } from "../styles/theme";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const [bootResolved, setBootResolved] = useState(false);
  const [initialRouteName, setInitialRouteName] =
    useState<keyof RootStackParamList>("Welcome");
  const [initialLoginParams, setInitialLoginParams] = useState<
    RootStackParamList["Login"]
  >({
    mode: "relay",
  });

  useEffect(() => {
    let active = true;

    const resolveBootRoute = async () => {
      const [accountToken, lastConnectionMode] = await Promise.all([
        getSecureItem(secureStorageKeys.controlPlaneAccessToken),
        getSecureItem(secureStorageKeys.connectionMode),
      ]);

      const hasAccountToken = Boolean(accountToken?.trim());
      const preferredMode =
        lastConnectionMode === "direct" ? "direct" : "relay";

      const nextRoute: keyof RootStackParamList = hasAccountToken
        ? "Login"
        : "Welcome";
      const nextLoginParams: RootStackParamList["Login"] = {
        mode: hasAccountToken ? "relay" : preferredMode,
      };

      if (!active) return;

      setInitialRouteName(nextRoute);
      setInitialLoginParams(nextLoginParams);
      setBootResolved(true);
    };

    void resolveBootRoute();

    return () => {
      active = false;
    };
  }, []);

  if (!bootResolved) {
    return (
      <View style={[styles.bootPlaceholder, { backgroundColor: theme.bg }]} />
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        gestureEnabled: true,
        headerStyle: {
          backgroundColor: theme.panel,
        },
        headerShadowVisible: false,
        headerTintColor: theme.text,
        statusBarTranslucent: false,
        headerTitleStyle: {
          color: theme.text,
          fontWeight: "700",
        },
        contentStyle: {
          backgroundColor: theme.bg,
        },
      }}
    >
      <Stack.Screen
        name="Welcome"
        component={WelcomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ConnectionMode"
        component={ConnectionModeScreen}
        options={{
          headerShown: false,
          animation: "slide_from_right",
        }}
      />
      <Stack.Screen
        name="Login"
        component={LoginScreen}
        initialParams={initialLoginParams}
        options={{
          headerShown: false,
          animation: "fade_from_bottom",
        }}
      />
      <Stack.Screen
        name="SearchHosts"
        component={SearchHostsScreen}
        options={{
          title: "搜索主机",
          animation: "slide_from_right",
        }}
      />
      <Stack.Screen
        name="RecentHosts"
        component={RecentHostsScreen}
        options={{
          title: "历史连接",
          animation: "slide_from_right",
        }}
      />
      <Stack.Screen
        name="Console"
        component={SessionPlaceholderScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  bootPlaceholder: {
    flex: 1,
  },
});
