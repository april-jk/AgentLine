import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getSecureItem,
  secureStorageKeys,
  setSecureItem,
} from "../lib/storage/secureStorage";
import type { ThemeMode } from "./theme";

type ThemePreferenceContextValue = {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemePreferenceContext =
  createContext<ThemePreferenceContextValue | null>(null);

const VALID_THEME_MODES: ThemeMode[] = ["auto", "light", "dark", "verydark"];

export function ThemePreferenceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("auto");

  useEffect(() => {
    const loadThemeMode = async () => {
      const stored = await getSecureItem(secureStorageKeys.uiThemeMode);
      if (stored && VALID_THEME_MODES.includes(stored as ThemeMode)) {
        setThemeModeState(stored as ThemeMode);
      }
    };

    void loadThemeMode();
  }, []);

  const value = useMemo<ThemePreferenceContextValue>(
    () => ({
      themeMode,
      setThemeMode: (mode) => {
        setThemeModeState(mode);
        void setSecureItem(secureStorageKeys.uiThemeMode, mode);
      },
    }),
    [themeMode],
  );

  return (
    <ThemePreferenceContext.Provider value={value}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference() {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error(
      "useThemePreference must be used within ThemePreferenceProvider",
    );
  }
  return context;
}
