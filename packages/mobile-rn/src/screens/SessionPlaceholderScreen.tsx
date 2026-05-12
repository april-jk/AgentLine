import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { normalizeHttpBaseUrl } from "../lib/api/client";
import type { RootStackParamList } from "../navigation/types";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import type { AppTheme } from "../styles/theme";
import { useAppTheme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Console">;

function stripHash(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
}

function getHash(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(hashIndex) : "";
}

function pushCandidate(targets: string[], seen: Set<string>, value: string) {
  if (seen.has(value)) return;
  seen.add(value);
  targets.push(value);
}

function parseBaseUrlParts(base: string): {
  protocol: string;
  host: string;
  port: number;
} | null {
  const match = base.match(/^(https?:)\/\/([^/:]+)(?::(\d+))?$/);
  if (!match?.[1] || !match[2]) return null;

  return {
    protocol: match[1],
    host: match[2],
    port: Number(match[3] || (match[1] === "https:" ? 443 : 80)),
  };
}

function isLoopbackOrEmulatorHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "10.0.2.2";
}

function buildLocalHostCandidates(host: string): string[] {
  if (host === "10.0.2.2") return ["127.0.0.1", "10.0.2.2"];
  if (host === "127.0.0.1") return ["127.0.0.1", "10.0.2.2"];
  if (host === "localhost") return ["127.0.0.1", "localhost", "10.0.2.2"];
  return [host];
}

function buildDirectHashForCandidate(
  sourceUri: string,
  protocol: string,
  host: string,
  serverPort: number,
): string {
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  const hash = getHash(sourceUri);
  const rawParams = hash.startsWith("#") ? hash.slice(1) : hash;
  const parts = rawParams
    .split("&")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("ws="));
  parts.push(
    `ws=${encodeURIComponent(`${wsProtocol}//${host}:${String(serverPort)}/api/ws`)}`,
  );
  const serialized = parts.join("&");
  return serialized ? `#${serialized}` : "";
}

function buildDirectCandidateUrls(
  sourceUri: string,
  serverUrl: string,
): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const hash = getHash(sourceUri);
  const base = normalizeHttpBaseUrl(serverUrl);

  const parsed = parseBaseUrlParts(base);
  if (parsed) {
    const { protocol, host, port: currentPort } = parsed;
    if (isLoopbackOrEmulatorHost(host)) {
      const devPorts = [
        currentPort + 2,
        3402,
        45733,
        currentPort + 3,
        3403,
        45734,
      ];
      const candidateHosts = buildLocalHostCandidates(host);

      for (const candidateHost of candidateHosts) {
        const candidateHash = buildDirectHashForCandidate(
          sourceUri,
          protocol,
          candidateHost,
          currentPort,
        );
        for (const port of devPorts) {
          if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
          pushCandidate(
            targets,
            seen,
            `${protocol}//${candidateHost}:${String(port)}/login/direct${candidateHash}`,
          );
        }
      }
    }
  }

  pushCandidate(targets, seen, `${base}/remote/login/direct${hash}`);
  pushCandidate(targets, seen, `${base}/login/direct${hash}`);
  pushCandidate(targets, seen, sourceUri);

  return targets;
}

function normalizeRelayWebBaseUrl(controlPlaneUrl: string): string {
  const base = normalizeHttpBaseUrl(controlPlaneUrl);
  if (base.endsWith("/remote/login/relay")) {
    return base.slice(0, -"/remote/login/relay".length);
  }
  if (base.endsWith("/login/relay")) {
    return base.slice(0, -"/login/relay".length);
  }
  if (base.endsWith("/remote")) return base.slice(0, -"/remote".length);
  return base;
}

function isLocalRemoteDevBase(baseUrl: string): boolean {
  return /^(http:\/\/)(127\.0\.0\.1|localhost|10\.0\.2\.2)(:\d+)?$/.test(
    baseUrl,
  );
}

function buildRelayCandidateUrls(
  sourceUri: string,
  controlPlaneUrl: string,
): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const hash = getHash(sourceUri);
  const base = normalizeRelayWebBaseUrl(controlPlaneUrl);

  if (isLocalRemoteDevBase(base)) {
    pushCandidate(targets, seen, `${base}/login/relay${hash}`);
  } else {
    pushCandidate(targets, seen, `${base}/remote/login/relay${hash}`);
    pushCandidate(targets, seen, `${base}/login/relay${hash}`);
    pushCandidate(targets, seen, `${base}/remote/${hash}`);
  }

  pushCandidate(targets, seen, `${base}/${hash}`);
  pushCandidate(targets, seen, sourceUri);

  return targets;
}

function isRemoteClientHtml(html: string): boolean {
  return (
    html.includes("AgentLine - Remote") ||
    html.includes("/src/remote-main.tsx") ||
    html.includes("/remote-main")
  );
}

async function canReachCandidate(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(stripHash(url), {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) return false;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return true;

    return isRemoteClientHtml(await response.text());
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function SessionPlaceholderScreen({ navigation, route }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolvedUri, setResolvedUri] = useState(route.params.source.uri);
  const [isResolvingSource, setIsResolvingSource] = useState(
    route.params.mode === "direct" || route.params.mode === "relay",
  );
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

  useEffect(() => {
    let cancelled = false;

    const resolveSource = async () => {
      setIsResolvingSource(true);
      setLoadError(null);
      const candidates =
        route.params.mode === "direct"
          ? buildDirectCandidateUrls(route.params.source.uri, route.params.url)
          : buildRelayCandidateUrls(route.params.source.uri, route.params.url);

      for (const candidate of candidates) {
        if (cancelled) return;
        setResolvedUri(candidate);
        if (await canReachCandidate(candidate)) {
          setIsResolvingSource(false);
          return;
        }
      }

      if (!cancelled) {
        setResolvedUri(candidates[0] ?? route.params.source.uri);
        setLoadError(
          `无法打开远程页面：${stripHash(candidates[0] ?? route.params.source.uri)}`,
        );
        setIsResolvingSource(false);
      }
    };

    void resolveSource();

    return () => {
      cancelled = true;
    };
  }, [route.params.mode, route.params.source.uri, route.params.url]);

  return (
    <SafeAreaView
      style={styles.container}
      edges={["top", "left", "right", "bottom"]}
    >
      {isResolvingSource ? (
        <View style={styles.centerOverlay}>
          <ActivityIndicator color={theme.primary} />
          <Text style={styles.helperText}>正在查找可用入口…</Text>
          <Text style={styles.debugText}>{stripHash(resolvedUri)}</Text>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: resolvedUri }}
          injectedJavaScriptBeforeContentLoaded={
            route.params.injectedJavaScriptBeforeContentLoaded
          }
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
              <Text style={styles.helperText}>正在连接 {route.params.url}</Text>
              <Text style={styles.debugText}>{stripHash(resolvedUri)}</Text>
            </View>
          )}
          startInLoadingState
          originWhitelist={["*"]}
          style={styles.webview}
        />
      )}
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
