import type { UpdateManifest } from "@agentline/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import {
  ApiClient,
  ApiRequestError,
  DEFAULT_CONTROL_PLANE_URL,
  normalizeHttpBaseUrl,
} from "../lib/api/client";
import {
  type ForwardingTarget,
  resolveForwardingTarget,
} from "../lib/forwarding/layer";
import {
  getSecureItem,
  secureStorageKeys,
  setSecureItem,
} from "../lib/storage/secureStorage";
import { getNativeUpdateUrl } from "../lib/updateDownloads";
import type { RootStackParamList } from "../navigation/types";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import type { AppTheme } from "../styles/theme";
import { useAppTheme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Console">;

const RECOVERY_CONFIRM_DELAY_MS = 1800;
const FOREGROUND_RECONNECT_THRESHOLD_MS = 2000;

type HostAccessPasswordMap = Record<string, string>;

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

function isConnectedAppPathname(pathname: string): boolean {
  return Boolean(pathname && !isWebLoginPath(pathname));
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

function canTreatRecoveryAsStaleAfterConnected(reason: string): boolean {
  return (
    reason === "web_login_blocked" ||
    reason === "relay_auth_required" ||
    reason === "direct_auth_required" ||
    reason === "relay_timeout" ||
    reason === "relay_unreachable" ||
    reason === "direct_unreachable"
  );
}

function parseHostAccessPasswords(raw: string | null): HostAccessPasswordMap {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const passwords: HostAccessPasswordMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && key.trim() && value.trim()) {
        passwords[key] = value;
      }
    }
    return passwords;
  } catch {
    return {};
  }
}

function resolveHostAccessPassword(
  passwords: HostAccessPasswordMap,
  options: {
    installId?: string | null;
    relayHostId?: string | null;
    relayPasswordFallback?: string | null;
  },
): string {
  const installId = options.installId?.trim();
  if (installId) {
    const value = passwords[`install:${installId}`]?.trim();
    if (value) return value;
  }

  const relayHostId = options.relayHostId?.trim();
  if (relayHostId) {
    const value = passwords[`relay:${relayHostId}`]?.trim();
    if (value) return value;
  }

  return options.relayPasswordFallback?.trim() ?? "";
}

function deriveRelayWsUrl(controlPlaneUrl: string): string {
  try {
    const normalized = normalizeHttpBaseUrl(controlPlaneUrl)
      .replace(/\/+$/, "")
      .replace(/^http:\/\//, "ws://")
      .replace(/^https:\/\//, "wss://");
    return `${normalized}/ws`;
  } catch {
    return "";
  }
}

function isRelayCredentialExpiredReason(reason: string): boolean {
  return (
    reason === "relay_auth_required" ||
    reason === "grant_invalid" ||
    reason === "grant_expired" ||
    reason === "grant_consumed" ||
    reason === "relay_timeout" ||
    reason === "relay_unreachable" ||
    reason === "web_login_blocked"
  );
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
    reason === "device_offline" ||
    reason === "server_offline" ||
    reason === "unknown_username"
  ) {
    return {
      title: "桌面端已退出",
      message: "桌面端当前不可用，请在电脑端重新登录并保持在线。",
    };
  }

  if (reason === "relay_timeout" || reason === "relay_unreachable") {
    return {
      title: "中继连接失败",
      message: "当前无法通过中继连接桌面端，请确认电脑端在线后返回应用重试。",
    };
  }

  if (reason === "direct_unreachable") {
    return {
      title: "局域网连接失败",
      message:
        "当前无法连接电脑端，请确认电脑端在线、地址可访问，并与手机处于同一网络。",
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

  if (reason === "auth_failed") {
    return {
      title: "连接认证失败",
      message: "这次远程连接认证没有通过，请返回应用重新输入访问密码后再试。",
    };
  }

  if (reason === "direct_auth_required") {
    return {
      title: "直连认证失败",
      message:
        "直连用户名或访问密码不正确。请返回应用，确认用户名来自电脑端，并输入电脑端设置里的访问密码。",
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

async function openNativeUpdate(update: UpdateManifest | null): Promise<void> {
  const url = getNativeUpdateUrl(
    update,
    Platform.OS === "ios" ? "ios" : "android",
  );
  if (!url) return;
  await Linking.openURL(url);
}

export function SessionPlaceholderScreen({ navigation, route }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const fixedUri = route.params.source.uri;

  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [nativeReconnectStatus, setNativeReconnectStatus] = useState<
    string | null
  >(null);
  const [canGoBackInWebView, setCanGoBackInWebView] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const lastStatusRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const currentPathnameRef = useRef("");
  const loginRecoveryTriggeredRef = useRef(false);
  const transientLoginBlockRetryRef = useRef(0);
  const webSessionConnectedRef = useRef(false);
  const promptedUpdateVersionRef = useRef<string | null>(null);
  const backgroundedAtRef = useRef<number | null>(null);
  const reconnectInFlightRef = useRef<Promise<void> | null>(null);
  const reconnectRunIdRef = useRef(0);
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

  const clearPendingRecovery = useCallback(() => {
    if (pendingRecoveryTimerRef.current) {
      clearTimeout(pendingRecoveryTimerRef.current);
      pendingRecoveryTimerRef.current = null;
    }
  }, []);

  const returnToNativeLogin = useCallback(
    (mode: "relay" | "direct" = fallbackMode) => {
      clearPendingRecovery();
      reconnectRunIdRef.current += 1;
      loginRecoveryTriggeredRef.current = true;
      navigation.reset({
        index: 0,
        routes: [{ name: "Login", params: { mode } }],
      });
    },
    [clearPendingRecovery, fallbackMode, navigation],
  );

  const buildFreshRelayTarget =
    useCallback(async (): Promise<ForwardingTarget> => {
      const [
        savedToken,
        savedControlPlaneUrl,
        savedHostId,
        savedRelayUsername,
        savedRelayWsUrl,
        savedHostAccessPasswords,
        savedRelayPassword,
      ] = await Promise.all([
        getSecureItem(secureStorageKeys.controlPlaneAccessToken),
        getSecureItem(secureStorageKeys.controlPlaneUrl),
        getSecureItem(secureStorageKeys.selectedRelayDeviceId),
        getSecureItem(secureStorageKeys.relayUsername),
        getSecureItem(secureStorageKeys.relayWsUrl),
        getSecureItem(secureStorageKeys.hostAccessPasswords),
        getSecureItem(secureStorageKeys.relayPassword),
      ]);

      const accountToken = savedToken?.trim() ?? "";
      if (!accountToken) {
        throw new Error("平台账号会话已失效，请重新登录平台账号。");
      }

      try {
        const controlPlaneBaseUrl = normalizeHttpBaseUrl(
          savedControlPlaneUrl?.trim() || DEFAULT_CONTROL_PLANE_URL,
        );
        const client = new ApiClient(controlPlaneBaseUrl);
        const hosts = await client.listHosts(accountToken);
        const relayUsernameHint =
          savedRelayUsername?.trim().toLowerCase() ?? "";
        const host =
          hosts.find((item) => item.id === savedHostId?.trim()) ??
          hosts.find(
            (item) =>
              item.relayUsername.trim().toLowerCase() === relayUsernameHint,
          ) ??
          null;

        if (!host) {
          throw new Error("目标设备已不可用或已解绑，请重新选择设备。");
        }
        if (host.relayState === "offline" || !host.heartbeatFresh) {
          throw new Error(
            "桌面端当前离线，请确认电脑端 AgentLine 在线后重试。",
          );
        }

        const passwords = parseHostAccessPasswords(savedHostAccessPasswords);
        const accessPassword = resolveHostAccessPassword(passwords, {
          installId: host.installId,
          relayHostId: host.id,
          relayPasswordFallback: savedRelayPassword,
        });
        if (!accessPassword) {
          throw new Error("缺少桌面端访问密码，请返回连接页重新输入。");
        }

        const grantPayload = await client.requestClientConnectGrant(
          accountToken,
          host.relayUsername,
          host.id,
        );
        const relayUsername =
          grantPayload.relayUsername?.trim().toLowerCase() ||
          host.relayUsername.trim().toLowerCase();
        const relayWsUrl =
          savedRelayWsUrl?.trim() || deriveRelayWsUrl(controlPlaneBaseUrl);

        await setSecureItem(secureStorageKeys.selectedRelayDeviceId, host.id);
        await setSecureItem(secureStorageKeys.relayUsername, relayUsername);
        if (relayWsUrl) {
          await setSecureItem(secureStorageKeys.relayWsUrl, relayWsUrl);
        }

        return resolveForwardingTarget({
          mode: "relay",
          controlPlaneUrl: controlPlaneBaseUrl,
          relayWsUrl,
          relayUsername,
          relayPassword: accessPassword,
          relayClientGrant: grantPayload.grant,
          themeMode,
        });
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          throw new Error("平台账号会话已失效，请重新登录平台账号。");
        }
        throw error;
      }
    }, [themeMode]);

  const attemptNativeReconnect = useCallback(
    async (reason: string) => {
      if (reconnectInFlightRef.current) {
        await reconnectInFlightRef.current;
        return;
      }

      const reconnectRunId = reconnectRunIdRef.current + 1;
      reconnectRunIdRef.current = reconnectRunId;
      const run = (async () => {
        clearPendingRecovery();
        setLoadError(null);
        setNativeReconnectStatus(
          route.params.mode === "relay"
            ? "正在重新连接桌面端…"
            : "正在恢复连接…",
        );
        showStatusToast("正在重新连接");

        if (route.params.mode === "relay") {
          try {
            const target = await buildFreshRelayTarget();
            if (
              reconnectRunIdRef.current !== reconnectRunId ||
              loginRecoveryTriggeredRef.current
            ) {
              return;
            }
            loginRecoveryTriggeredRef.current = false;
            transientLoginBlockRetryRef.current = 0;
            navigation.replace("Console", target);
            return;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "重新连接失败";
            console.log("[SessionPlaceholder] Native relay reconnect failed", {
              reason,
              message,
            });
            if (
              reconnectRunIdRef.current !== reconnectRunId ||
              loginRecoveryTriggeredRef.current
            ) {
              return;
            }
            setNativeReconnectStatus(message);
            if (
              message.includes("平台账号会话已失效") ||
              message.includes("重新登录平台账号")
            ) {
              await setSecureItem(
                secureStorageKeys.controlPlaneAccessToken,
                "",
              );
            }
            return;
          }
        }

        webViewRef.current?.reload();
        setNativeReconnectStatus(null);
      })().finally(() => {
        if (reconnectRunIdRef.current === reconnectRunId) {
          reconnectInFlightRef.current = null;
        }
      });

      reconnectInFlightRef.current = run;
      await run;
    },
    [
      buildFreshRelayTarget,
      clearPendingRecovery,
      navigation,
      route.params.mode,
      showStatusToast,
    ],
  );

  const recoverToNativeLogin = useCallback(
    (reason: string, modeGuess?: "relay" | "direct") => {
      if (loginRecoveryTriggeredRef.current) return;
      loginRecoveryTriggeredRef.current = true;
      clearPendingRecovery();

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
    [clearPendingRecovery, fallbackMode, navigation, showStatusToast],
  );

  const requestRecoverToNativeLogin = useCallback(
    (reason: string, modeGuess?: "relay" | "direct") => {
      if (loginRecoveryTriggeredRef.current) return;
      const mode = modeGuess ?? fallbackMode;
      if (mode === "relay" && isRelayCredentialExpiredReason(reason)) {
        void attemptNativeReconnect(reason);
        return;
      }
      if (
        webSessionConnectedRef.current &&
        canTreatRecoveryAsStaleAfterConnected(reason) &&
        isConnectedAppPathname(currentPathnameRef.current)
      ) {
        console.log(
          "[SessionPlaceholder] Ignoring stale recovery after connected app is active.",
          {
            reason,
            currentPathname: currentPathnameRef.current,
          },
        );
        return;
      }

      clearPendingRecovery();
      pendingRecoveryTimerRef.current = setTimeout(() => {
        pendingRecoveryTimerRef.current = null;
        if (
          webSessionConnectedRef.current &&
          canTreatRecoveryAsStaleAfterConnected(reason) &&
          isConnectedAppPathname(currentPathnameRef.current)
        ) {
          console.log(
            "[SessionPlaceholder] Cancelled pending recovery because app connected.",
            {
              reason,
              currentPathname: currentPathnameRef.current,
            },
          );
          return;
        }
        recoverToNativeLogin(reason, modeGuess);
      }, RECOVERY_CONFIRM_DELAY_MS);
    },
    [
      attemptNativeReconnect,
      clearPendingRecovery,
      fallbackMode,
      recoverToNativeLogin,
    ],
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (loginRecoveryTriggeredRef.current) return;
      if (nativeReconnectStatus || isWebLoginPath(currentPathnameRef.current)) {
        event.preventDefault();
        returnToNativeLogin(fallbackMode);
        return;
      }
      if (!canGoBackInWebView) return;
      event.preventDefault();
      webViewRef.current?.goBack();
    });
    return unsubscribe;
  }, [
    navigation,
    canGoBackInWebView,
    fallbackMode,
    nativeReconnectStatus,
    returnToNativeLogin,
  ]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (
          nativeReconnectStatus ||
          isWebLoginPath(currentPathnameRef.current)
        ) {
          returnToNativeLogin(fallbackMode);
          return true;
        }
        if (canGoBackInWebView) {
          webViewRef.current?.goBack();
          return true;
        }
        returnToNativeLogin(fallbackMode);
        return true;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [
    canGoBackInWebView,
    fallbackMode,
    nativeReconnectStatus,
    returnToNativeLogin,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        backgroundedAtRef.current = Date.now();
        return;
      }
      if (nextState !== "active") return;

      const backgroundedAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      const elapsed =
        backgroundedAt === null ? null : Date.now() - backgroundedAt;
      if (
        elapsed !== null &&
        elapsed >= FOREGROUND_RECONNECT_THRESHOLD_MS &&
        route.params.mode === "relay" &&
        (nativeReconnectStatus ||
          loadError ||
          isWebLoginPath(currentPathnameRef.current))
      ) {
        void attemptNativeReconnect("app-foreground");
      }
    });

    return () => {
      subscription.remove();
    };
  }, [
    attemptNativeReconnect,
    loadError,
    nativeReconnectStatus,
    route.params.mode,
  ]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      clearPendingRecovery();
    };
  }, [clearPendingRecovery]);

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
            webViewRef.current?.stopLoading();

            if (authLoginPath) {
              console.log(
                "[SessionPlaceholder] Auth login route is not allowed in native shell; recovering to RN flow.",
                { pathname, reason, modeGuess },
              );
            }

            requestRecoverToNativeLogin(reason, modeGuess);
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
            route.params.mode === "relay" ? "中继页面已加载" : "页面已加载",
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
            requestRecoverToNativeLogin(
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
                  current?: string;
                  latest?: string;
                  update?: UpdateManifest | null;
                }
              | undefined;
            if (payload?.type) {
              console.log("[SessionPlaceholder] Bridge message", payload);
            }
            if (payload?.type === "agentline-native-shell-connected") {
              webSessionConnectedRef.current = true;
              transientLoginBlockRetryRef.current = 0;
              setNativeReconnectStatus(null);
              clearPendingRecovery();
              showStatusToast(
                route.params.mode === "relay" ? "中继已连接" : "已连接",
              );
              return;
            }
            if (payload?.type === "agentline-native-shell-recovery") {
              const reason =
                typeof payload.reason === "string"
                  ? payload.reason
                  : "web_login_blocked";
              const reportedPathname =
                typeof payload.pathname === "string" ? payload.pathname : "";
              requestRecoverToNativeLogin(
                reason,
                inferModeFromLoginPath(reportedPathname, fallbackMode),
              );
              return;
            }
            if (payload?.type === "agentline-update-available") {
              if (!payload.latest) return;
              if (promptedUpdateVersionRef.current === payload.latest) return;
              promptedUpdateVersionRef.current = payload.latest;
              Alert.alert(
                "发现新版本",
                `AgentLine v${payload.latest} 已可用，当前版本是 v${payload.current ?? "unknown"}。`,
                [
                  { text: "稍后", style: "cancel" },
                  {
                    text: "下载更新",
                    onPress: () => {
                      void openNativeUpdate(payload.update ?? null);
                    },
                  },
                ],
              );
              return;
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
              requestRecoverToNativeLogin(
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

      {nativeReconnectStatus ? (
        <View style={styles.reconnectPanel}>
          {nativeReconnectStatus.includes("…") ? (
            <ActivityIndicator color={theme.primary} />
          ) : null}
          <Text style={styles.reconnectTitle}>
            {nativeReconnectStatus.includes("…")
              ? "正在恢复连接"
              : "连接需要处理"}
          </Text>
          <Text style={styles.reconnectMessage}>{nativeReconnectStatus}</Text>
          <View style={styles.reconnectActions}>
            <Pressable
              style={styles.secondaryAction}
              onPress={() => returnToNativeLogin(fallbackMode)}
            >
              <Text style={styles.secondaryActionText}>返回连接页</Text>
            </Pressable>
            <Pressable
              style={styles.primaryAction}
              onPress={() => void attemptNativeReconnect("manual-retry")}
            >
              <Text style={styles.primaryActionText}>重新连接</Text>
            </Pressable>
          </View>
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
    reconnectPanel: {
      position: "absolute",
      left: theme.spaceMd,
      right: theme.spaceMd,
      bottom: theme.spaceXl + 44,
      gap: theme.spaceSm,
      borderRadius: theme.radiusLg,
      backgroundColor: theme.panel,
      borderWidth: 1,
      borderColor: theme.border,
      padding: theme.spaceMd,
      shadowColor: "#000000",
      shadowOpacity: 0.16,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 5,
    },
    reconnectTitle: {
      color: theme.text,
      fontSize: 15,
      fontWeight: "700",
      textAlign: "center",
    },
    reconnectMessage: {
      color: theme.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
    },
    reconnectActions: {
      flexDirection: "row",
      gap: theme.spaceSm,
      marginTop: theme.spaceXs,
    },
    primaryAction: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
      borderRadius: theme.radiusMd,
      backgroundColor: theme.primary,
      paddingHorizontal: theme.spaceMd,
    },
    primaryActionText: {
      color: theme.isLight ? "#ffffff" : "#0f172a",
      fontSize: 14,
      fontWeight: "700",
    },
    secondaryAction: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
      borderRadius: theme.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panelAlt,
      paddingHorizontal: theme.spaceMd,
    },
    secondaryActionText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: "700",
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
