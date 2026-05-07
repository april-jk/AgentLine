import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { RootStackParamList } from "../navigation/types";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import type { AppTheme, ThemeMode } from "../styles/theme";
import { useAppTheme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Console">;

export function SessionPlaceholderScreen({ route }: Props) {
  const { themeMode, setThemeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { url, mode, source, injectedJavaScriptBeforeContentLoaded } =
    route.params;

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        value?: string;
      };

      if (
        payload.type === "agentline-theme" &&
        payload.value &&
        ["auto", "light", "dark", "verydark"].includes(payload.value)
      ) {
        setThemeMode(payload.value as ThemeMode);
      }
    } catch {
      // Ignore unrelated postMessage traffic from the app.
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.modeBar}>
        <View style={styles.modeBarHeader}>
          <Text style={styles.titleText}>控制台</Text>
          <View style={styles.modePill}>
            <Text style={styles.modePillText}>
              {mode === "direct" ? "直连" : "中转"}
            </Text>
          </View>
        </View>
        <Text style={styles.urlLabel}>连接目标</Text>
        <Text style={styles.urlText} numberOfLines={1}>
          {url}
        </Text>
      </View>

      <WebView
        source={source}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        injectedJavaScriptBeforeContentLoaded={
          injectedJavaScriptBeforeContentLoaded
        }
        onMessage={handleMessage}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.primary} />
            <Text style={styles.loadingText}>正在加载控制台...</Text>
          </View>
        )}
        renderError={(errorName) => (
          <View style={styles.loadingWrap}>
            <Text style={styles.errorText}>页面加载失败：{errorName}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    modeBar: {
      backgroundColor: theme.panel,
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      paddingHorizontal: theme.spaceLg,
      paddingVertical: theme.spaceMd,
    },
    modeBarHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spaceSm,
    },
    titleText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: "700",
    },
    modePill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: theme.panelAlt,
      borderWidth: 1,
      borderColor: theme.borderSoft,
    },
    modePillText: {
      color: theme.success,
      fontSize: 11,
      fontWeight: "700",
    },
    urlLabel: {
      color: theme.textDimmed,
      fontSize: 11,
      marginTop: theme.spaceSm,
    },
    urlText: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    loadingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.bg,
      gap: 8,
    },
    loadingText: {
      color: theme.textSecondary,
    },
    errorText: {
      color: theme.danger,
      paddingHorizontal: 16,
      textAlign: "center",
    },
  });
