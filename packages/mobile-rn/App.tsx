import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { checkForNativeUpdate } from "./src/lib/updateCheck";
import { RootNavigator } from "./src/navigation/RootNavigator";
import {
  ThemePreferenceProvider,
  useThemePreference,
} from "./src/styles/ThemePreferenceContext";
import { useAppTheme } from "./src/styles/theme";

function AppShell() {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const baseTheme = theme.isLight ? DefaultTheme : DarkTheme;

  useEffect(() => {
    void checkForNativeUpdate();
  }, []);

  const navigationTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: theme.bg,
      card: theme.panel,
      border: theme.border,
      text: theme.text,
      primary: theme.brandTeal,
    },
  };

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
        <StatusBar
          style={theme.isLight ? "dark" : "light"}
          translucent={false}
        />
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <ThemePreferenceProvider>
      <AppShell />
    </ThemePreferenceProvider>
  );
}
