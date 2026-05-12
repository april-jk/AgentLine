import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import type { RootStackParamList } from "../navigation/types";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import type { AppTheme } from "../styles/theme";
import { useAppTheme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Console">;

function stripHash(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
}

export function SessionPlaceholderScreen({ navigation, route }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fixedUri = route.params.source.uri;

  const [loadError, setLoadError] = useState<string | null>(null);
  const [canGoBackInWebView, setCanGoBackInWebView] = useState(false);
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    navigation.setOptions({ title: route.params.title });
  }, [navigation, route.params.title]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (!canGoBackInWebView) return;
      event.preventDefault();
      webViewRef.current?.goBack();
    });
    return unsubscribe;
  }, [navigation, canGoBackInWebView]);

  return (
    <SafeAreaView
      style={styles.container}
      edges={["top", "left", "right", "bottom"]}
    >
      <WebView
        ref={webViewRef}
        source={{ uri: fixedUri }}
        injectedJavaScriptBeforeContentLoaded={
          route.params.injectedJavaScriptBeforeContentLoaded
        }
        onNavigationStateChange={(state: WebViewNavigation) => {
          setCanGoBackInWebView(state.canGoBack);
        }}
        onError={(event) => {
          setLoadError(
            event.nativeEvent.description ||
              `页面加载失败：${stripHash(fixedUri)}`,
          );
        }}
        onHttpError={(event) => {
          setLoadError(
            `HTTP ${String(event.nativeEvent.statusCode)}：${stripHash(fixedUri)}`,
          );
        }}
        renderLoading={() => (
          <View style={styles.centerOverlay}>
            <ActivityIndicator color={theme.primary} />
            <Text style={styles.helperText}>正在打开固定入口…</Text>
            <Text style={styles.debugText}>{stripHash(fixedUri)}</Text>
          </View>
        )}
        startInLoadingState
        originWhitelist={["*"]}
        style={styles.webview}
      />

      {loadError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    webview: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    centerOverlay: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spaceMd,
      backgroundColor: theme.bg,
      padding: theme.spaceLg,
    },
    helperText: {
      color: theme.textSecondary,
      textAlign: "center",
    },
    debugText: {
      color: theme.textDimmed,
      fontSize: 12,
      textAlign: "center",
    },
    errorBanner: {
      position: "absolute",
      left: theme.spaceMd,
      right: theme.spaceMd,
      bottom: theme.spaceMd,
      borderRadius: theme.radiusLg,
      backgroundColor: theme.panel,
      borderWidth: 1,
      borderColor: theme.danger,
      paddingHorizontal: theme.spaceMd,
      paddingVertical: theme.spaceSm,
    },
    errorText: {
      color: theme.danger,
      textAlign: "center",
    },
  });
