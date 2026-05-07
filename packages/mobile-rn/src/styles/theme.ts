import { useMemo } from "react";
import { type ColorSchemeName, useColorScheme } from "react-native";

export type ThemeMode = "auto" | "light" | "dark" | "verydark";

export type AppTheme = {
  brandTeal: string;
  brandTealDark: string;
  brandBlue: string;
  bg: string;
  panel: string;
  panelAlt: string;
  panelHover: string;
  input: string;
  overlay: string;
  border: string;
  borderSoft: string;
  borderInput: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textDimmed: string;
  primary: string;
  link: string;
  primaryPressed: string;
  success: string;
  warning: string;
  danger: string;
  focus: string;
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
  radiusXl: number;
  spaceXs: number;
  spaceSm: number;
  spaceMd: number;
  spaceLg: number;
  spaceXl: number;
  isLight: boolean;
};

const baseTheme = {
  brandTeal: "#059669",
  brandTealDark: "#047857",
  brandBlue: "#2563eb",
  radiusSm: 4,
  radiusMd: 6,
  radiusLg: 8,
  radiusXl: 12,
  spaceXs: 4,
  spaceSm: 8,
  spaceMd: 12,
  spaceLg: 16,
  spaceXl: 24,
} as const;

const lightTheme: AppTheme = {
  ...baseTheme,
  bg: "#faf9f5",
  panel: "#f5f4f0",
  panelAlt: "#eeede8",
  panelHover: "#e8e7e2",
  input: "#ffffff",
  overlay: "rgba(0, 0, 0, 0.3)",
  border: "#d4d3ce",
  borderSoft: "#e0dfd9",
  borderInput: "#c0bfb8",
  text: "#1a1a1a",
  textSecondary: "#3a3a3a",
  textMuted: "#5a5a5a",
  textDimmed: "#8a8a8a",
  primary: "#2563eb",
  link: "#0066cc",
  primaryPressed: "#1d4ed8",
  success: "#1a7f37",
  warning: "#9a6700",
  danger: "#cf222e",
  focus: "#0066cc",
  isLight: true,
};

const darkTheme: AppTheme = {
  ...baseTheme,
  bg: "#2f2f2f",
  panel: "#363636",
  panelAlt: "#3d3d3d",
  panelHover: "#454545",
  input: "#3a3a3a",
  overlay: "rgba(0, 0, 0, 0.5)",
  border: "#4a4a4a",
  borderSoft: "#444444",
  borderInput: "#555555",
  text: "#e0e0e0",
  textSecondary: "#c0c0c0",
  textMuted: "#a0a0a0",
  textDimmed: "#707070",
  primary: "#60a5fa",
  link: "#5db5ff",
  primaryPressed: "#3b82f6",
  success: "#7dd39a",
  warning: "#ebd09d",
  danger: "#e05545",
  focus: "#007acc",
  isLight: false,
};

const verydarkTheme: AppTheme = {
  ...baseTheme,
  bg: "#181818",
  panel: "#1f1f1f",
  panelAlt: "#252525",
  panelHover: "#2a2d2e",
  input: "#2a2a2a",
  overlay: "rgba(0, 0, 0, 0.5)",
  border: "#3c3c3c",
  borderSoft: "#333333",
  borderInput: "#444444",
  text: "#cccccc",
  textSecondary: "#b8b8b8",
  textMuted: "#9d9d9d",
  textDimmed: "#666666",
  primary: "#60a5fa",
  link: "#4daafc",
  primaryPressed: "#3b82f6",
  success: "#74c991",
  warning: "#e1c08d",
  danger: "#c74e39",
  focus: "#007acc",
  isLight: false,
};

export function resolveTheme(
  mode: ThemeMode = "auto",
  systemColorScheme?: ColorSchemeName,
): AppTheme {
  if (mode === "light") return lightTheme;
  if (mode === "dark") return darkTheme;
  if (mode === "verydark") return verydarkTheme;

  return systemColorScheme === "light" ? lightTheme : darkTheme;
}

export function useAppTheme(mode: ThemeMode = "auto"): AppTheme {
  const systemColorScheme = useColorScheme();
  return useMemo(
    () => resolveTheme(mode, systemColorScheme),
    [mode, systemColorScheme],
  );
}
