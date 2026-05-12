import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from "react-native-webview";
import type { RootStackParamList } from "../navigation/types";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import type { AppTheme } from "../styles/theme";
import { useAppTheme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Console">;

function stripHash(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
}

function buildNativeRelayProbeScript(mode: "direct" | "relay"): string {
  const shouldProbeRelay = mode === "relay";
  return `
    (function () {
      var post = function (payload) {
        try {
          window.ReactNativeWebView &&
            window.ReactNativeWebView.postMessage(
              JSON.stringify(payload),
            );
        } catch {}
      };

      post({
        type: "agentline-native-shell",
        stage: "bootstrap",
        href: window.location && window.location.href ? window.location.href : "",
      });

      if (!${JSON.stringify(shouldProbeRelay)}) return;

      try {
        var NativeWS = window.WebSocket;
        if (!NativeWS) {
          post({ type: "agentline-relay-trace", stage: "ws-missing" });
          return;
        }

        var WrappedWebSocket = function (url, protocols) {
          var targetUrl = String(url || "");
          post({
            type: "agentline-relay-trace",
            stage: "ws-create",
            url: targetUrl,
          });

          var ws =
            protocols === undefined
              ? new NativeWS(url)
              : new NativeWS(url, protocols);

          try {
            ws.addEventListener("open", function () {
              post({
                type: "agentline-relay-trace",
                stage: "ws-open",
                url: targetUrl,
              });
            });
            ws.addEventListener("close", function (event) {
              post({
                type: "agentline-relay-trace",
                stage: "ws-close",
                url: targetUrl,
                code: event && typeof event.code === "number" ? event.code : null,
              });
            });
            ws.addEventListener("error", function () {
              post({
                type: "agentline-relay-trace",
                stage: "ws-error",
                url: targetUrl,
              });
            });
          } catch {}

          return ws;
        };

        WrappedWebSocket.prototype = NativeWS.prototype;
        WrappedWebSocket.CONNECTING = NativeWS.CONNECTING;
        WrappedWebSocket.OPEN = NativeWS.OPEN;
        WrappedWebSocket.CLOSING = NativeWS.CLOSING;
        WrappedWebSocket.CLOSED = NativeWS.CLOSED;

        window.WebSocket = WrappedWebSocket;
      } catch (error) {
        post({
          type: "agentline-relay-trace",
          stage: "probe-error",
          message: error && error.message ? String(error.message) : "unknown",
        });
      }
    })();
    true;
  `;
}

export function SessionPlaceholderScreen({ navigation, route }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fixedUri = route.params.source.uri;

  const [loadError, setLoadError] = useState<string | null>(null);
  const [canGoBackInWebView, setCanGoBackInWebView] = useState(false);
  const [relayTrace, setRelayTrace] = useState<string>("waiting");
  const [relayConnected, setRelayConnected] = useState(false);
  const webViewRef = useRef<WebView>(null);

  const injectedScript = useMemo(() => {
    const shellScript =
      route.params.injectedJavaScriptBeforeContentLoaded?.trim() ?? "";
    const probeScript = buildNativeRelayProbeScript(route.params.mode);
    return shellScript ? `${shellScript}\n${probeScript}` : probeScript;
  }, [route.params.injectedJavaScriptBeforeContentLoaded, route.params.mode]);

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

  const handleWebMessage = (event: WebViewMessageEvent) => {
    const raw = event.nativeEvent.data;
    if (!raw) return;

    try {
      const payload = JSON.parse(raw) as {
        type?: string;
        stage?: string;
        url?: string;
      };
      if (payload.type !== "agentline-relay-trace") return;
      const stage = payload.stage ?? "unknown";
      const line = payload.url
        ? `${stage}: ${payload.url}`
        : `${stage}: (no-url)`;
      setRelayTrace(line);
      if (stage === "ws-open") {
        setRelayConnected(true);
      }
      if (stage === "ws-close" || stage === "ws-error") {
        setRelayConnected(false);
      }
    } catch {
      // ignore non-JSON messages
    }
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={["top", "left", "right", "bottom"]}
    >
      <WebView
        ref={webViewRef}
        source={{ uri: fixedUri }}
        injectedJavaScriptBeforeContentLoaded={injectedScript}
        onMessage={handleWebMessage}
        onNavigationStateChange={(state: WebViewNavigation) => {
          setCanGoBackInWebView(state.canGoBack);
        }}
        onError={(event) => {
          setLoadError(event.nativeEvent.description || "页面加载失败");
        }}
        onHttpError={(event) => {
          setLoadError(`HTTP ${String(event.nativeEvent.statusCode)}`);
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

      <View style={styles.connectionBanner}>
        <Text style={styles.connectionTitle}>
          {route.params.mode === "relay"
            ? relayConnected
              ? "中继链路: 已建立"
              : "中继链路: 建立中"
            : "直连模式"}
        </Text>
        <Text style={styles.debugText} numberOfLines={2}>
          {route.params.mode === "relay" ? relayTrace : stripHash(fixedUri)}
        </Text>
      </View>

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
    connectionBanner: {
      position: "absolute",
      left: theme.spaceMd,
      right: theme.spaceMd,
      top: theme.spaceMd,
      borderRadius: theme.radiusLg,
      backgroundColor: theme.panel,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: theme.spaceMd,
      paddingVertical: theme.spaceSm,
      gap: 4,
    },
    connectionTitle: {
      color: theme.text,
      fontWeight: "600",
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
