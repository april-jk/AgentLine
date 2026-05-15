import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
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

function normalizePathnameFromUrl(url: string): string {
  const withoutHash = url.split("#", 1)[0] ?? "";
  const withoutQuery = withoutHash.split("?", 1)[0] ?? "";
  const absoluteMatch = withoutQuery.match(/^[a-z]+:\/\/[^/]+(\/.*)$/i);
  const pathname = absoluteMatch?.[1] ?? withoutQuery;
  return pathname.replace(/\/+$/, "").toLowerCase();
}

function isWebLoginPath(pathname: string): boolean {
  if (!pathname) return false;
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/remote/login" ||
    pathname.startsWith("/remote/login/")
  );
}

function isAuthLoginPath(pathname: string): boolean {
  if (!pathname) return false;
  return (
    pathname === "/login/relay" ||
    pathname.startsWith("/login/relay/") ||
    pathname === "/remote/login/relay" ||
    pathname.startsWith("/remote/login/relay/") ||
    pathname === "/login/direct" ||
    pathname.startsWith("/login/direct/") ||
    pathname === "/remote/login/direct" ||
    pathname.startsWith("/remote/login/direct/")
  );
}

function inferModeFromLoginPath(
  pathname: string,
  fallbackMode: "relay" | "direct",
): "relay" | "direct" {
  if (pathname.includes("/login/direct")) return "direct";
  if (pathname.includes("/login/relay")) return "relay";
  return fallbackMode;
}

function inferLoginReason(url: string): string {
  const withoutHash = url.split("#", 1)[0] ?? "";
  const queryIndex = withoutHash.indexOf("?");
  const pathname = normalizePathnameFromUrl(url);
  if (queryIndex < 0) {
    if (pathname.includes("/login/relay")) return "relay_auth_required";
    if (pathname.includes("/login/direct")) return "direct_auth_required";
    return "web_login_blocked";
  }
  const queryText = withoutHash.slice(queryIndex + 1);
  for (const segment of queryText.split("&")) {
    if (!segment) continue;
    const [rawKey, rawValue = ""] = segment.split("=", 2);
    if (decodeURIComponent(rawKey ?? "") !== "reason") continue;
    const decoded = decodeURIComponent(rawValue).trim();
    if (decoded) return decoded;
  }
  return "web_login_blocked";
}

function resolveLoginRecoveryCopy(
  reason: string,
  mode: "relay" | "direct",
): { title: string; message: string } {
  if (
    reason === "unauthorized" ||
    reason === "account_auth_required" ||
    reason === "control_plane_unauthorized"
  ) {
    return {
      title: "账号已失效",
      message: "平台账号会话已失效，请返回应用重新登录平台账号。",
    };
  }

  if (
    reason === "device_not_found" ||
    reason === "server_offline" ||
    reason === "unknown_username"
  ) {
    return {
      title: "桌面端已退出",
      message: "桌面端当前不可用，请在电脑端重新登录并保持在线。",
    };
  }

  if (
    reason === "grant_invalid" ||
    reason === "grant_expired" ||
    reason === "grant_consumed" ||
    reason === "relay_auth_required"
  ) {
    return {
      title: "连接已失效",
      message: "本次中继连接已失效，请重新选择设备并再次连接。",
    };
  }

  if (reason === "direct_auth_required") {
    return {
      title: "直连认证失败",
      message: "直连会话已失效，请返回应用重新输入直连账号信息。",
    };
  }

  return {
    title: "需要重新连接",
    message:
      mode === "relay"
        ? "连接状态已变化，请返回应用重新登录并选择设备连接。"
        : "连接状态已变化，请返回应用重新进行局域网直连。",
  };
}

export function SessionPlaceholderScreen({ navigation, route }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fixedUri = route.params.source.uri;

  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [canGoBackInWebView, setCanGoBackInWebView] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const lastStatusRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPathnameRef = useRef("");
  const loginRecoveryTriggeredRef = useRef(false);
  const transientLoginBlockRetryRef = useRef(0);
  const fallbackMode = route.params.mode === "direct" ? "direct" : "relay";

  const showStatusToast = useCallback((nextStatus: string) => {
    if (lastStatusRef.current === nextStatus) return;
    lastStatusRef.current = nextStatus;
    setStatusToast(nextStatus);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setStatusToast(null);
    }, 3000);
  }, []);

  const recoverToNativeLogin = useCallback(
    (reason: string, modeGuess?: "relay" | "direct") => {
      if (loginRecoveryTriggeredRef.current) return;
      loginRecoveryTriggeredRef.current = true;

      const mode = modeGuess ?? fallbackMode;
      const copy = resolveLoginRecoveryCopy(reason, mode);
      showStatusToast("连接已失效，返回应用登录");

      Alert.alert(copy.title, copy.message, [
        {
          text: "确定",
          onPress: () => {
            navigation.reset({
              index: 0,
              routes: [{ name: "Login", params: { mode } }],
            });
          },
        },
      ]);
    },
    [fallbackMode, navigation, showStatusToast],
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (!canGoBackInWebView) return;
      event.preventDefault();
      webViewRef.current?.goBack();
    });
    return unsubscribe;
  }, [navigation, canGoBackInWebView]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

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
          const pathname = normalizePathnameFromUrl(state.url);
          currentPathnameRef.current = pathname;
          console.log("[SessionPlaceholder] WebView navigation", {
            url: stripHash(state.url),
            pathname,
            canGoBack: state.canGoBack,
          });
          if (isWebLoginPath(pathname)) {
            const reason = inferLoginReason(state.url);
            console.log("[SessionPlaceholder] Hit web login path", {
              pathname,
              reason,
              fallbackMode,
            });
            const modeGuess = inferModeFromLoginPath(pathname, fallbackMode);
            const authLoginPath = isAuthLoginPath(pathname);

            // /login/relay and /login/direct are now part of the expected
            // mobile bootstrap path. Do not treat them as immediate failures.
            if (
              authLoginPath &&
              (reason === "relay_auth_required" ||
                reason === "direct_auth_required")
            ) {
              console.log(
                "[SessionPlaceholder] Auth login route reached during bootstrap; waiting for auto-connect.",
                { pathname, reason, modeGuess },
              );
              return;
            }

            // Do not preemptively block login route navigation. Let remote page
            // emit explicit bridge reason first, to avoid false-positive
            // "connection changed" regressions on mobile WebView.
            if (reason !== "web_login_blocked") {
              webViewRef.current?.stopLoading();
              recoverToNativeLogin(reason, modeGuess);
            }
          }
        }}
        onLoadStart={() => {
          showStatusToast(
            route.params.mode === "relay" ? "中继连接中" : "连接中",
          );
        }}
        onLoadEnd={() => {
          transientLoginBlockRetryRef.current = 0;
          showStatusToast(
            route.params.mode === "relay" ? "中继已连接" : "已连接",
          );
        }}
        onError={(event) => {
          showStatusToast("连接失败");
          setLoadError(
            event.nativeEvent.description ||
              `页面加载失败：${stripHash(fixedUri)}`,
          );
        }}
        onHttpError={(event) => {
          showStatusToast("连接失败");
          const statusCode = event.nativeEvent.statusCode;
          if (statusCode === 401 || statusCode === 403) {
            recoverToNativeLogin(
              "unauthorized",
              route.params.mode === "direct" ? "direct" : "relay",
            );
          }
          setLoadError(`HTTP ${String(statusCode)}：${stripHash(fixedUri)}`);
        }}
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data) as
              | {
                  type?: string;
                  status?: string;
                  reason?: string;
                  pathname?: string;
                }
              | undefined;
            if (payload?.type) {
              console.log("[SessionPlaceholder] Bridge message", payload);
            }
            if (payload?.type === "agentline-login-route-blocked") {
              const reason =
                typeof payload.reason === "string"
                  ? payload.reason
                  : "web_login_blocked";
              const reportedPathname =
                typeof payload.pathname === "string" ? payload.pathname : "";
              const effectivePathname =
                reportedPathname || currentPathnameRef.current;
              if (
                effectivePathname &&
                !isWebLoginPath(effectivePathname) &&
                reason !== "unauthorized" &&
                reason !== "account_auth_required" &&
                reason !== "control_plane_unauthorized"
              ) {
                console.log(
                  "[SessionPlaceholder] Ignoring stale login-block message after app route is active.",
                  {
                    reason,
                    reportedPathname,
                    currentPathname: currentPathnameRef.current,
                  },
                );
                return;
              }
              if (reason === "web_login_blocked") {
                transientLoginBlockRetryRef.current += 1;
                if (transientLoginBlockRetryRef.current <= 1) {
                  showStatusToast("连接状态同步中，正在重试…");
                  webViewRef.current?.reload();
                  return;
                }
              }
              recoverToNativeLogin(
                reason,
                inferModeFromLoginPath(effectivePathname, fallbackMode),
              );
              return;
            }
            if (payload?.type !== "agentline-style-recovery") return;
            if (payload?.status === "inline") {
              showStatusToast("样式恢复成功");
              return;
            }
            if (payload?.status === "failed") {
              showStatusToast("样式加载异常");
            }
          } catch {
            // Ignore non-JSON bridge messages
          }
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

      {statusToast ? (
        <View style={styles.statusToast}>
          <Text style={styles.statusToastText}>{statusToast}</Text>
        </View>
      ) : null}

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
    statusToast: {
      position: "absolute",
      bottom: theme.spaceXl + 8,
      alignSelf: "center",
      backgroundColor: theme.panel,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: theme.radiusLg,
      paddingHorizontal: theme.spaceMd,
      paddingVertical: theme.spaceSm,
      opacity: 0.95,
      maxWidth: "80%",
    },
    statusToastText: {
      color: theme.textSecondary,
      textAlign: "center",
      fontSize: 12,
      fontWeight: "600",
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
