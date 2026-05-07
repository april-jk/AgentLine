import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
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
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style={theme.isLight ? "dark" : "light"} />
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemePreferenceProvider>
      <AppShell />
    </ThemePreferenceProvider>
  );
}
