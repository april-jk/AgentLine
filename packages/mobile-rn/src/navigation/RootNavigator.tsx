import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { LoginScreen } from "../screens/LoginScreen";
import { SessionPlaceholderScreen } from "../screens/SessionPlaceholderScreen";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import { useAppTheme } from "../styles/theme";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);

  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.panel,
        },
        headerShadowVisible: false,
        headerTintColor: theme.text,
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
        name="Login"
        component={LoginScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Console"
        component={SessionPlaceholderScreen}
        options={{ title: "控制台" }}
      />
    </Stack.Navigator>
  );
}
