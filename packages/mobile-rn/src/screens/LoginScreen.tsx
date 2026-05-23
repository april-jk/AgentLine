import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DEFAULT_DESKTOP_DISCOVERY_PORT } from "../../../shared/dist/desktop-discovery.js";
import {
  ApiClient,
  ApiRequestError,
  DEFAULT_CONTROL_PLANE_URL,
  DirectServerClient,
  type HostItem,
  isDirectServerInfo,
  normalizeHttpBaseUrl,
} from "../lib/api/client";
import {
  type ForwardMode,
  resolveForwardingTarget,
} from "../lib/forwarding/layer";
import {
  getSecureItem,
  secureStorageKeys,
  setSecureItem,
} from "../lib/storage/secureStorage";
import type { RootStackParamList } from "../navigation/types";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import type { AppTheme } from "../styles/theme";
import { useAppTheme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;
type AccountMode = "login" | "register";
type HostAccessPasswordMap = Record<string, string>;
const LEGACY_DIRECT_USERNAME_PLACEHOLDER = "mobiletest";

function normalizeAccessPassword(value: string | null | undefined): string {
  return value?.trim() ?? "";
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

function resolveHostAccessPasswordKey(options: {
  installId?: string | null;
  relayHostId?: string | null;
  serverUrl?: string | null;
}): string {
  const installId = options.installId?.trim();
  if (installId) return `install:${installId}`;

  const relayHostId = options.relayHostId?.trim();
  if (relayHostId) return `relay:${relayHostId}`;

  const serverUrl = options.serverUrl?.trim();
  if (serverUrl) return `direct:${normalizeHttpBaseUrl(serverUrl)}`;

  return "";
}

function getSavedHostAccessPassword(
  passwords: HostAccessPasswordMap,
  hostKey: string,
): string {
  return hostKey ? normalizeAccessPassword(passwords[hostKey]) : "";
}

function getPortFromUrl(url: string): string {
  const match = url.match(/:(\d+)(?:\/|$)/);
  return match?.[1] ?? String(DEFAULT_DESKTOP_DISCOVERY_PORT);
}

function isLoopbackServerUrl(url: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(
    url.trim(),
  );
}

function isRoutableLanPrefix(prefix: string): boolean {
  const match = prefix.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const a = Number(match[1] ?? -1);
  const b = Number(match[2] ?? -1);
  const c = Number(match[3] ?? -1);
  if (![a, b, c].every((part) => Number.isInteger(part))) return false;
  if ([a, b, c].some((part) => part < 0 || part > 255)) return false;
  if (a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function getSubnetPrefixFromUrl(url: string): string | null {
  const match = url
    .trim()
    .match(/^https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}(?::\d+)?/i);
  const prefix = match?.[1] ?? null;
  if (!prefix || !isRoutableLanPrefix(prefix)) return null;
  return prefix;
}

function buildKnownServerUrls(
  hosts: HostItem[],
  preferredHostId: string | null,
): string[] {
  const sortedHosts = [...hosts].sort((a, b) => {
    if (a.id === preferredHostId) return -1;
    if (b.id === preferredHostId) return 1;
    return 0;
  });

  const urls: string[] = [];
  for (const host of sortedHosts) {
    const address = host.lanEndpoint?.address?.trim();
    const port = host.lanEndpoint?.port;
    if (!address || typeof port !== "number") continue;
    if (host.hostServiceListening === false) continue;
    urls.push(normalizeHttpBaseUrl(`http://${address}:${String(port)}`));
  }

  return Array.from(new Set(urls));
}

function getHostLanUrl(host: HostItem | null): string {
  const address = host?.lanEndpoint?.address?.trim();
  const port = host?.lanEndpoint?.port;
  if (!address || typeof port !== "number") return "";
  return normalizeHttpBaseUrl(`http://${address}:${String(port)}`);
}

function isSameServerUrl(left: string, right: string): boolean {
  if (!left.trim() || !right.trim()) return false;
  return normalizeHttpBaseUrl(left) === normalizeHttpBaseUrl(right);
}

function buildExpectedInstallIds(
  hosts: HostItem[],
  preferredHostId: string | null,
): string[] {
  const sortedHosts = [...hosts].sort((a, b) => {
    if (a.id === preferredHostId) return -1;
    if (b.id === preferredHostId) return 1;
    return 0;
  });

  const installIds: string[] = [];
  for (const host of sortedHosts) {
    const installId = host.installId?.trim();
    if (!installId) continue;
    if (!installIds.includes(installId)) {
      installIds.push(installId);
    }
  }

  return installIds;
}

function deriveRelayWsUrl(controlPlaneUrl: string): string {
  try {
    const normalized = normalizeHttpBaseUrl(controlPlaneUrl)
      .replace(/\/+$/, "")
      .replace(/^http:\/\//, "ws://")
      .replace(/^https:\/\//, "wss://");
    return `${normalized}/ws`;
  } catch {
    return "wss://relay.agentline.com/ws";
  }
}

function redactForwardingUri(rawUri: string): string {
  return rawUri
    .replace(/([#&]p=)[^&]*/gi, "$1***")
    .replace(/([#&]cg=)[^&]*/gi, "$1***");
}

function statusColor(
  relayState: HostItem["relayState"],
  theme: AppTheme,
): string {
  if (relayState === "paired") return "#16a34a";
  if (relayState === "waiting") return "#f59e0b";
  return theme.textMuted;
}

function formatHeartbeatAge(ageMs?: number): string {
  if (typeof ageMs !== "number") return "未知";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${String(seconds)} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} 分钟前`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)} 小时前`;
}

function resolveRelayOfflineHint(host: HostItem): string {
  const heartbeatText = `最近心跳：${formatHeartbeatAge(host.heartbeatAgeMs)}`;
  if (host.heartbeatOffline) {
    return `${heartbeatText}，已超过离线阈值（1 分钟）。请确认电脑端已登录平台账号并保持 AgentLine 前台运行。`;
  }
  return `${heartbeatText}。请确认电脑端 AgentLine 正在运行并已登录平台账号。`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

type RelayRecovery = {
  title: string;
  message: string;
  clearAccount: boolean;
};

function resolveRelayRecovery(error: unknown): RelayRecovery {
  if (error instanceof ApiRequestError) {
    if (
      error.status === 401 ||
      error.code === "unauthorized" ||
      error.code === "control_plane_unauthorized"
    ) {
      return {
        title: "账号已失效",
        message: "平台账号会话已失效，请重新登录平台账号后再连接桌面设备。",
        clearAccount: true,
      };
    }

    if (error.code === "device_not_found" || error.code === "device_offline") {
      return {
        title: error.code === "device_offline" ? "桌面端离线" : "桌面端已退出",
        message:
          "目标设备已不可用或已解绑，请在电脑端重新登录并保持在线后重试。",
        clearAccount: false,
      };
    }
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("unauthorized") ||
      msg.includes("account_auth_required") ||
      msg.includes("grant_invalid") ||
      msg.includes("grant_expired") ||
      msg.includes("grant_consumed")
    ) {
      return {
        title: "账号已失效",
        message: "平台账号会话已失效，请重新登录平台账号后再连接桌面设备。",
        clearAccount: true,
      };
    }

    if (msg.includes("device_not_found") || msg.includes("device_offline")) {
      return {
        title: msg.includes("device_offline") ? "桌面端离线" : "桌面端已退出",
        message:
          "目标设备已不可用或已解绑，请在电脑端重新登录并保持在线后重试。",
        clearAccount: false,
      };
    }
  }

  return {
    title: "连接失败",
    message: error instanceof Error ? error.message : "连接失败，请稍后重试。",
    clearAccount: false,
  };
}

export function LoginScreen({ navigation, route }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [directServerUrl, setDirectServerUrl] = useState(
    `http://127.0.0.1:${String(DEFAULT_DESKTOP_DISCOVERY_PORT)}`,
  );
  const [directUsername, setDirectUsername] = useState("");

  const controlPlaneUrl = DEFAULT_CONTROL_PLANE_URL;
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountMode, setAccountMode] = useState<AccountMode>("login");
  const [accountToken, setAccountToken] = useState("");
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [hosts, setHosts] = useState<HostItem[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [hostAccessPasswords, setHostAccessPasswords] =
    useState<HostAccessPasswordMap>({});
  const [accessPasswordDraft, setAccessPasswordDraft] = useState("");
  const [rememberAccessPassword, setRememberAccessPassword] = useState(true);
  const [showAccessPasswordModal, setShowAccessPasswordModal] = useState(false);
  const [accessPasswordHostKey, setAccessPasswordHostKey] = useState("");
  const [accessPasswordHostLabel, setAccessPasswordHostLabel] = useState("");
  const [accessPasswordModalMode, setAccessPasswordModalMode] =
    useState<ForwardMode>("relay");
  const [pendingDirectConnect, setPendingDirectConnect] = useState<{
    serverUrl: string;
    expectedInstallIdOverride?: string;
    usernameOverride?: string;
  } | null>(null);
  const [relayBusy, setRelayBusy] = useState(false);
  const [showDirectAdvanced, setShowDirectAdvanced] = useState(false);
  const [recentServers, setRecentServers] = useState<string[]>([]);
  const [directSelectedInstallId, setDirectSelectedInstallId] = useState("");

  const selectedHost = useMemo(
    () => hosts.find((item) => item.id === selectedHostId) ?? null,
    [hosts, selectedHostId],
  );
  const selectedHostAccessPasswordKey = useMemo(
    () =>
      resolveHostAccessPasswordKey({
        installId: selectedHost?.installId,
        relayHostId: selectedHost?.id,
      }),
    [selectedHost],
  );
  const knownServerUrls = useMemo(
    () => buildKnownServerUrls(hosts, selectedHostId),
    [hosts, selectedHostId],
  );
  const expectedInstallIds = useMemo(
    () => buildExpectedInstallIds(hosts, selectedHostId),
    [hosts, selectedHostId],
  );
  const resolveExpectedDirectInstallId = useCallback(
    (serverUrl: string, installIdOverride?: string) => {
      const override = installIdOverride?.trim();
      if (override) return override;

      const scannedInstallId = directSelectedInstallId.trim();
      if (scannedInstallId) return scannedInstallId;

      const relayLanUrl = getHostLanUrl(selectedHost);
      const relayInstallId = selectedHost?.installId?.trim();
      if (
        relayInstallId &&
        relayLanUrl &&
        isSameServerUrl(serverUrl, relayLanUrl)
      ) {
        return relayInstallId;
      }

      return "";
    },
    [directSelectedInstallId, selectedHost],
  );
  const hasAccountToken = accountToken.trim().length > 0;
  const loginMode: ForwardMode =
    route.params?.mode === "direct" || route.params?.selectedHostUrl
      ? "direct"
      : "relay";
  const showRelayDevicePage = loginMode === "relay" && hasAccountToken;
  const showRelayBottomSwitch = loginMode === "relay";

  const recoverToRelayLogin = useCallback(
    async (recovery: RelayRecovery) => {
      if (recovery.clearAccount) {
        setAccountToken("");
        setHosts([]);
        setSelectedHostId(null);
        await setSecureItem(secureStorageKeys.controlPlaneAccessToken, "");
        await setSecureItem(secureStorageKeys.selectedRelayDeviceId, "");
      }

      navigation.reset({
        index: 0,
        routes: [{ name: "Login", params: { mode: "relay" } }],
      });
      Alert.alert(recovery.title, recovery.message);
    },
    [navigation],
  );

  const loadRelayHosts = useCallback(
    async (token: string, urlOverride?: string) => {
      const targetUrl = (urlOverride ?? controlPlaneUrl).trim();
      if (!token.trim() || !targetUrl) return;

      setRelayBusy(true);
      try {
        const client = new ApiClient(normalizeHttpBaseUrl(targetUrl));
        const list = await client.listHosts(token);
        setHosts(list);
        setSelectedHostId((current) => {
          if (current && list.some((item) => item.id === current)) {
            return current;
          }
          return list[0]?.id ?? null;
        });
      } catch (error) {
        const recovery = resolveRelayRecovery(error);
        if (recovery.clearAccount) {
          await recoverToRelayLogin(recovery);
        } else {
          Alert.alert(recovery.title, recovery.message);
        }
      } finally {
        setRelayBusy(false);
      }
    },
    [controlPlaneUrl, recoverToRelayLogin],
  );

  useEffect(() => {
    const bootstrap = async () => {
      const [
        savedDirect,
        savedDirectUsername,
        savedAccountToken,
        savedAccountEmail,
        savedSelectedHostId,
        savedHostAccessPasswords,
        savedRecent,
      ] = await Promise.all([
        getSecureItem(secureStorageKeys.directServerUrl),
        getSecureItem(secureStorageKeys.directUsername),
        getSecureItem(secureStorageKeys.controlPlaneAccessToken),
        getSecureItem(secureStorageKeys.controlPlaneAccountEmail),
        getSecureItem(secureStorageKeys.selectedRelayDeviceId),
        getSecureItem(secureStorageKeys.hostAccessPasswords),
        getSecureItem(secureStorageKeys.recentDirectServers),
      ]);

      if (savedDirect?.trim()) setDirectServerUrl(savedDirect);
      if (
        savedDirectUsername?.trim() &&
        savedDirectUsername.trim() !== LEGACY_DIRECT_USERNAME_PLACEHOLDER
      ) {
        setDirectUsername(savedDirectUsername);
      }
      setHostAccessPasswords(
        parseHostAccessPasswords(savedHostAccessPasswords),
      );
      if (savedAccountToken?.trim()) setAccountToken(savedAccountToken);
      if (savedAccountEmail?.trim()) setAccountEmail(savedAccountEmail);
      if (savedSelectedHostId?.trim()) setSelectedHostId(savedSelectedHostId);
      if (savedRecent) {
        try {
          const arr = JSON.parse(savedRecent) as unknown;
          if (Array.isArray(arr)) {
            setRecentServers(
              arr
                .filter((x): x is string => typeof x === "string")
                .slice(0, 10),
            );
          }
        } catch {
          // ignore bad cache
        }
      }

      if (savedAccountToken?.trim()) {
        await loadRelayHosts(savedAccountToken, DEFAULT_CONTROL_PLANE_URL);
      }
      setBootstrapDone(true);
    };

    void bootstrap();
  }, [loadRelayHosts]);

  useEffect(() => {
    if (!bootstrapDone || !accountToken.trim()) return;
    void loadRelayHosts(accountToken);
  }, [accountToken, bootstrapDone, loadRelayHosts]);

  const saveRecent = useCallback(
    async (url: string) => {
      const deduped = [url, ...recentServers.filter((x) => x !== url)].slice(
        0,
        10,
      );
      setRecentServers(deduped);
      await setSecureItem(
        secureStorageKeys.recentDirectServers,
        JSON.stringify(deduped),
      );
    },
    [recentServers],
  );

  const persistAccessPassword = useCallback(
    async (hostKey: string, password: string, remember: boolean) => {
      if (!hostKey) return;
      const nextPasswords = { ...hostAccessPasswords };
      if (remember) {
        nextPasswords[hostKey] = password;
      } else {
        delete nextPasswords[hostKey];
      }
      setHostAccessPasswords(nextPasswords);
      await setSecureItem(
        secureStorageKeys.hostAccessPasswords,
        JSON.stringify(nextPasswords),
      );
    },
    [hostAccessPasswords],
  );

  const openDirectConsole = useCallback(
    async (
      serverUrl = directServerUrl,
      expectedInstallIdOverride?: string,
      accessPasswordOverride?: string,
      usernameOverride?: string,
    ) => {
      try {
        if (!serverUrl.trim()) {
          Alert.alert("缺少地址", "请填写电脑端 AgentLine 地址");
          return;
        }

        const preflightClient = new DirectServerClient(serverUrl);
        const heartbeat = await withTimeout(preflightClient.getHealth(), 2500);
        if (heartbeat.status !== "ok") {
          Alert.alert(
            "桌面端不可达",
            "心跳校验失败：当前无法访问桌面端服务，请确认电脑端 AgentLine 已启动并与手机处于同一网络。",
          );
          return;
        }
        const serverInfo = await withTimeout(
          preflightClient.getServerInfo(),
          2500,
        );
        if (!isDirectServerInfo(serverInfo)) {
          Alert.alert(
            "连到了其他服务",
            "这个地址上虽然有 HTTP 服务，但不是 AgentLine 主服务。请检查端口是否填成了维护/调试服务端口，或重新用自动搜索选择主机。",
          );
          return;
        }
        const expectedDirectInstallId = resolveExpectedDirectInstallId(
          serverUrl,
          expectedInstallIdOverride,
        );
        if (
          expectedDirectInstallId &&
          serverInfo.installId?.trim() &&
          serverInfo.installId.trim() !== expectedDirectInstallId
        ) {
          Alert.alert(
            "连到了其他 AgentLine 实例",
            "这个地址上的 AgentLine 与当前选中的局域网主机信息不一致。请重新自动搜索并选择最新结果。",
          );
          return;
        }
        const selectedRelayUsername = selectedHost?.relayUsername?.trim();
        const selectedHostMatchesServer =
          Boolean(selectedRelayUsername) &&
          ((Boolean(selectedHost?.installId?.trim()) &&
            selectedHost?.installId?.trim() === serverInfo.installId?.trim()) ||
            isSameServerUrl(serverUrl, getHostLanUrl(selectedHost)));
        const serverAccessUsername =
          serverInfo.hostAccess?.username?.trim() ||
          (selectedHostMatchesServer ? selectedRelayUsername : undefined);
        const usernameFromSelection = usernameOverride?.trim();
        const storedDirectUsername = directUsername.trim();
        const currentUsername = usernameFromSelection || storedDirectUsername;
        const resolvedDirectUsername =
          !currentUsername ||
          currentUsername === LEGACY_DIRECT_USERNAME_PLACEHOLDER
            ? (serverAccessUsername ?? currentUsername)
            : currentUsername;
        if (!resolvedDirectUsername) {
          Alert.alert(
            "缺少用户名",
            "没有从桌面端读取到直连用户名。请在电脑端设置远程访问/本机访问密码后重新搜索，或手动填写直连用户名。",
          );
          return;
        }
        const directHostAccessPasswordKey = resolveHostAccessPasswordKey({
          installId: serverInfo.installId,
          serverUrl,
        });
        const savedDirectAccessPassword = getSavedHostAccessPassword(
          hostAccessPasswords,
          directHostAccessPasswordKey,
        );
        const accessPassword = normalizeAccessPassword(accessPasswordOverride);
        if (!accessPassword) {
          setAccessPasswordModalMode("direct");
          setAccessPasswordHostKey(directHostAccessPasswordKey);
          setAccessPasswordHostLabel(serverInfo.host || serverUrl);
          setPendingDirectConnect({
            serverUrl,
            expectedInstallIdOverride,
            usernameOverride: resolvedDirectUsername,
          });
          setAccessPasswordDraft(savedDirectAccessPassword);
          setRememberAccessPassword(true);
          setShowAccessPasswordModal(true);
          return;
        }
        if (resolvedDirectUsername !== storedDirectUsername) {
          setDirectUsername(resolvedDirectUsername);
        }

        const target = resolveForwardingTarget({
          mode: "direct",
          directServerUrl: serverUrl,
          directUsername: resolvedDirectUsername,
          directPassword: accessPassword,
          themeMode,
        });
        await setSecureItem(secureStorageKeys.connectionMode, "direct");
        await setSecureItem(secureStorageKeys.directServerUrl, target.url);
        await setSecureItem(
          secureStorageKeys.directUsername,
          resolvedDirectUsername,
        );
        await saveRecent(target.url);
        navigation.navigate("Console", target);
      } catch (error) {
        Alert.alert(
          "打开失败",
          error instanceof Error ? error.message : "未知错误",
        );
      }
    },
    [
      directServerUrl,
      directUsername,
      navigation,
      resolveExpectedDirectInstallId,
      saveRecent,
      selectedHost,
      hostAccessPasswords,
      themeMode,
    ],
  );

  const submitRelayAccount = async () => {
    const email = accountEmail.trim();
    if (!email || !accountPassword.trim()) {
      Alert.alert("信息不完整", "请填写账号邮箱和密码");
      return;
    }

    setRelayBusy(true);
    try {
      const client = new ApiClient(normalizeHttpBaseUrl(controlPlaneUrl));
      const authResult =
        accountMode === "register"
          ? await client.register({ email, password: accountPassword })
          : await client.login({ email, password: accountPassword });

      await setSecureItem(
        secureStorageKeys.controlPlaneUrl,
        normalizeHttpBaseUrl(controlPlaneUrl),
      );
      await setSecureItem(
        secureStorageKeys.controlPlaneAccessToken,
        authResult.accessToken,
      );
      await setSecureItem(secureStorageKeys.controlPlaneAccountEmail, email);
      await setSecureItem(secureStorageKeys.mobileOnboardingDone, "1");
      setAccountToken(authResult.accessToken);
      setAccountPassword("");
      await loadRelayHosts(authResult.accessToken, controlPlaneUrl);
      navigation.reset({
        index: 0,
        routes: [{ name: "Login", params: { mode: "relay" } }],
      });
    } catch (error) {
      Alert.alert(
        accountMode === "register" ? "注册失败" : "登录失败",
        error instanceof Error ? error.message : "未知错误",
      );
    } finally {
      setRelayBusy(false);
    }
  };

  const clearRelayAccount = async () => {
    setAccountToken("");
    setHosts([]);
    setSelectedHostId(null);
    await setSecureItem(secureStorageKeys.controlPlaneAccessToken, "");
  };

  const openRelayConsole = async (accessPassword: string) => {
    try {
      if (!selectedHost) {
        Alert.alert("请选择主机", "先选择要连接的电脑");
        return;
      }
      if (!accountToken.trim()) {
        Alert.alert("会话已失效", "平台账号状态已失效，请重新登录。");
        return;
      }
      if (!accessPassword.trim()) {
        Alert.alert("缺少访问密码", "请输入桌面端设置的访问密码");
        return;
      }

      const controlPlaneBaseUrl = normalizeHttpBaseUrl(controlPlaneUrl);
      const client = new ApiClient(controlPlaneBaseUrl);
      const latestHosts = await client.listHosts(accountToken);
      setHosts(latestHosts);
      const latestHost =
        latestHosts.find((item) => item.id === selectedHost.id) ?? null;
      if (!latestHost) {
        Alert.alert(
          "桌面端已退出",
          "该设备已不在在线列表，请刷新设备列表后重试。",
        );
        return;
      }
      if (latestHost.relayState === "offline") {
        Alert.alert("桌面端离线", resolveRelayOfflineHint(latestHost));
        return;
      }
      if (!latestHost.heartbeatFresh) {
        Alert.alert("心跳已过期", resolveRelayOfflineHint(latestHost));
        return;
      }
      const relayOnline = await client.isRelayHostOnline(
        latestHost.relayUsername,
      );
      if (!relayOnline) {
        Alert.alert(
          "桌面端未就绪",
          "中继路由当前不可达，请稍后重试或在电脑端重新打开 AgentLine。",
        );
        return;
      }

      const grantPayload = await client.requestClientConnectGrant(
        accountToken,
        latestHost.relayUsername,
        latestHost.id,
      );

      const resolvedRelayUsername =
        grantPayload.relayUsername?.trim().toLowerCase() ||
        latestHost.relayUsername;

      const target = resolveForwardingTarget({
        mode: "relay",
        controlPlaneUrl: controlPlaneBaseUrl,
        relayWsUrl: deriveRelayWsUrl(controlPlaneUrl),
        relayUsername: resolvedRelayUsername,
        relayPassword: accessPassword,
        relayClientGrant: grantPayload.grant,
        themeMode,
      });
      console.log("[LoginScreen] Opening relay WebView target", {
        hostId: latestHost.id,
        relayUsername: resolvedRelayUsername,
        relayState: latestHost.relayState,
        uri: redactForwardingUri(target.source.uri),
      });

      await setSecureItem(secureStorageKeys.connectionMode, "relay");
      await setSecureItem(
        secureStorageKeys.controlPlaneUrl,
        controlPlaneBaseUrl,
      );
      await setSecureItem(
        secureStorageKeys.relayWsUrl,
        deriveRelayWsUrl(controlPlaneBaseUrl),
      );
      await setSecureItem(
        secureStorageKeys.relayUsername,
        resolvedRelayUsername,
      );
      await setSecureItem(
        secureStorageKeys.selectedRelayDeviceId,
        latestHost.id,
      );
      navigation.navigate("Console", target);
    } catch (error) {
      const recovery = resolveRelayRecovery(error);
      await recoverToRelayLogin(recovery);
    }
  };

  const handleRelayConnectPress = () => {
    if (!selectedHost) {
      Alert.alert("请选择主机", "先选择要连接的电脑");
      return;
    }

    const hostKey = selectedHostAccessPasswordKey;
    setAccessPasswordDraft(
      getSavedHostAccessPassword(hostAccessPasswords, hostKey),
    );
    setAccessPasswordHostKey(hostKey);
    setAccessPasswordHostLabel(selectedHost.name);
    setAccessPasswordModalMode("relay");
    setPendingDirectConnect(null);
    setRememberAccessPassword(true);
    setShowAccessPasswordModal(true);
  };

  const handleConfirmAccessPassword = async () => {
    const password = accessPasswordDraft.trim();
    if (!password) {
      Alert.alert("缺少访问密码", "请输入桌面端设置的访问密码");
      return;
    }

    await persistAccessPassword(
      accessPasswordHostKey,
      password,
      rememberAccessPassword,
    );

    const modalMode = accessPasswordModalMode;
    const pendingDirect = pendingDirectConnect;
    setShowAccessPasswordModal(false);
    setAccessPasswordDraft("");
    setAccessPasswordHostKey("");
    setAccessPasswordHostLabel("");
    setPendingDirectConnect(null);

    if (modalMode === "direct" && pendingDirect) {
      void openDirectConsole(
        pendingDirect.serverUrl,
        pendingDirect.expectedInstallIdOverride,
        password,
        pendingDirect.usernameOverride,
      );
      return;
    }

    void openRelayConsole(password);
  };

  useEffect(() => {
    const selectedHostUrl = route.params?.selectedHostUrl;
    if (!selectedHostUrl?.trim()) return;
    const selectedHostInstallId =
      route.params?.selectedHostInstallId?.trim() ?? "";
    const selectedHostAccessUsername =
      route.params?.selectedHostAccessUsername?.trim() ?? "";

    setDirectServerUrl(selectedHostUrl);
    setDirectSelectedInstallId(selectedHostInstallId);
    if (selectedHostAccessUsername) {
      setDirectUsername(selectedHostAccessUsername);
    }
    void saveRecent(selectedHostUrl);

    if (route.params?.connectOnSelect) {
      void openDirectConsole(
        selectedHostUrl,
        selectedHostInstallId,
        undefined,
        selectedHostAccessUsername,
      );
    }

    navigation.setParams({
      selectedHostUrl: undefined,
      selectedHostInstallId: undefined,
      selectedHostAccessUsername: undefined,
      connectOnSelect: undefined,
    });
  }, [
    navigation,
    openDirectConsole,
    route.params?.connectOnSelect,
    route.params?.selectedHostAccessUsername,
    route.params?.selectedHostInstallId,
    route.params?.selectedHostUrl,
    saveRecent,
  ]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.container,
          loginMode === "direct" || showRelayDevicePage || showRelayBottomSwitch
            ? styles.containerCentered
            : null,
        ]}
      >
        <View style={styles.surface}>
          {loginMode === "relay" && !hasAccountToken ? (
            <View style={[styles.formSection, styles.formSectionCentered]}>
              <Text style={styles.formTitle}>平台账号登录</Text>
              <View style={styles.modeSwitch}>
                <Pressable
                  style={[
                    styles.modeTab,
                    accountMode === "login" ? styles.modeTabActive : null,
                  ]}
                  onPress={() => setAccountMode("login")}
                >
                  <Text
                    style={[
                      styles.modeTabText,
                      accountMode === "login" ? styles.modeTabTextActive : null,
                    ]}
                  >
                    登录
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modeTab,
                    accountMode === "register" ? styles.modeTabActive : null,
                  ]}
                  onPress={() => setAccountMode("register")}
                >
                  <Text
                    style={[
                      styles.modeTabText,
                      accountMode === "register"
                        ? styles.modeTabTextActive
                        : null,
                    ]}
                  >
                    注册
                  </Text>
                </Pressable>
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>账号邮箱</Text>
                <TextInput
                  style={styles.input}
                  value={accountEmail}
                  onChangeText={setAccountEmail}
                  autoCapitalize="none"
                  placeholder="you@example.com"
                  placeholderTextColor={theme.textMuted}
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>账号密码</Text>
                <TextInput
                  style={styles.input}
                  value={accountPassword}
                  onChangeText={setAccountPassword}
                  secureTextEntry
                  placeholder="平台账号密码"
                  placeholderTextColor={theme.textMuted}
                />
              </View>
              <Pressable
                style={[
                  styles.primaryButton,
                  relayBusy ? styles.buttonDisabled : null,
                ]}
                onPress={() => void submitRelayAccount()}
                disabled={relayBusy}
              >
                <Text style={styles.primaryButtonText}>
                  {relayBusy
                    ? "处理中..."
                    : accountMode === "register"
                      ? "注册并继续"
                      : "登录并继续"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {loginMode === "relay" && hasAccountToken ? (
            <View style={[styles.formSection, styles.formSectionCentered]}>
              <Text style={styles.formTitle}>选择设备并连接</Text>
              <Text style={styles.formMetaText}>
                当前平台账号：{accountEmail || "已登录"}
              </Text>
              <View style={styles.inlineActionsRow}>
                <Pressable
                  style={[styles.utilityButton, styles.utilityButtonInline]}
                  onPress={() => void loadRelayHosts(accountToken)}
                >
                  <Text style={styles.utilityButtonText}>刷新设备列表</Text>
                </Pressable>
                <Pressable
                  style={[styles.utilityButton, styles.utilityButtonInline]}
                  onPress={() => void clearRelayAccount()}
                >
                  <Text style={styles.utilityButtonText}>退出账号</Text>
                </Pressable>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>已绑定设备</Text>
                {hosts.length > 0 ? (
                  <View style={styles.hostList}>
                    {hosts.map((host) => {
                      const selected = selectedHostId === host.id;
                      return (
                        <Pressable
                          key={host.id}
                          style={[
                            styles.hostItem,
                            selected ? styles.hostItemSelected : null,
                          ]}
                          onPress={() => setSelectedHostId(host.id)}
                        >
                          <View style={styles.hostItemMain}>
                            <View
                              style={[
                                styles.hostDot,
                                {
                                  backgroundColor: statusColor(
                                    host.relayState,
                                    theme,
                                  ),
                                },
                              ]}
                            />
                            <Text style={styles.hostName}>{host.name}</Text>
                            <Text style={styles.hostModeBadge}>
                              {host.deviceType}
                            </Text>
                          </View>
                          <View style={styles.hostItemMeta}>
                            <Text style={styles.hostMetaText}>
                              {host.relayUsername}
                            </Text>
                            <Text style={styles.hostMetaText}>
                              状态：{host.relayState}
                            </Text>
                            <Text
                              style={[
                                styles.hostMetaText,
                                !host.heartbeatFresh
                                  ? styles.hostMetaWarnText
                                  : null,
                              ]}
                            >
                              心跳：{formatHeartbeatAge(host.heartbeatAgeMs)}
                              {host.heartbeatOffline ? "（离线）" : ""}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.emptyText}>
                    没有找到已绑定设备，请先在桌面端登录同一账号并保持在线。
                  </Text>
                )}
              </View>

              <Pressable
                style={[
                  styles.primaryButton,
                  relayBusy ? styles.buttonDisabled : null,
                ]}
                onPress={handleRelayConnectPress}
                disabled={relayBusy}
              >
                <Text style={styles.primaryButtonText}>
                  {relayBusy ? "连接中..." : "连接到选中设备"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {loginMode === "direct" ? (
            <View style={[styles.formSection, styles.formSectionCentered]}>
              <Text style={styles.formTitle}>局域网直连</Text>

              <Pressable
                style={styles.utilityButton}
                onPress={() => {
                  const seedServerUrl =
                    knownServerUrls[0] &&
                    (!directServerUrl.trim() ||
                      isLoopbackServerUrl(directServerUrl))
                      ? knownServerUrls[0]
                      : directServerUrl;

                  navigation.push("SearchHosts", {
                    currentServerUrl: seedServerUrl || directServerUrl,
                    recentServers,
                    scanPrefix:
                      getSubnetPrefixFromUrl(seedServerUrl) ?? "192.168.1",
                    scanPort: getPortFromUrl(seedServerUrl),
                    knownServerUrls,
                    expectedInstallIds,
                  });
                }}
              >
                <Text style={styles.utilityButtonText}>自动搜索局域网主机</Text>
              </Pressable>

              <Pressable
                style={styles.utilityButton}
                onPress={() =>
                  navigation.push("RecentHosts", {
                    currentServerUrl: directServerUrl,
                    recentServers,
                  })
                }
              >
                <Text style={styles.utilityButtonText}>连接历史</Text>
              </Pressable>

              <Pressable
                style={styles.utilityButton}
                onPress={() => setShowDirectAdvanced((value) => !value)}
              >
                <Text style={styles.utilityButtonText}>
                  {showDirectAdvanced ? "隐藏高级" : "高级"}
                </Text>
              </Pressable>

              {showDirectAdvanced ? (
                <>
                  <View style={styles.formGroup}>
                    <Text style={styles.fieldLabel}>电脑端地址</Text>
                    <TextInput
                      style={styles.input}
                      value={directServerUrl}
                      onChangeText={(value) => {
                        setDirectServerUrl(value);
                        setDirectSelectedInstallId("");
                      }}
                      autoCapitalize="none"
                      placeholder={`http://127.0.0.1:${String(
                        DEFAULT_DESKTOP_DISCOVERY_PORT,
                      )}`}
                      placeholderTextColor={theme.textMuted}
                    />
                  </View>
                  <View style={styles.formGroup}>
                    <Text style={styles.fieldLabel}>用户名</Text>
                    <TextInput
                      style={styles.input}
                      value={directUsername}
                      onChangeText={setDirectUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="直连用户名"
                      placeholderTextColor={theme.textMuted}
                    />
                  </View>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={() => void openDirectConsole()}
                  >
                    <Text style={styles.primaryButtonText}>连接</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {showRelayBottomSwitch ? (
        <View style={styles.bottomDock}>
          <Pressable
            style={styles.bottomTextAction}
            onPress={() => navigation.push("Login", { mode: "direct" })}
          >
            <Text style={styles.bottomTextActionText}>使用局域网连接</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal
        transparent
        animationType="fade"
        visible={showAccessPasswordModal}
        onRequestClose={() => {
          setShowAccessPasswordModal(false);
          setPendingDirectConnect(null);
          setAccessPasswordHostKey("");
          setAccessPasswordHostLabel("");
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>输入访问密码</Text>
            <Text style={styles.modalHint}>
              {accessPasswordModalMode === "direct"
                ? `连接 ${
                    accessPasswordHostLabel || "局域网主机"
                  } 前请输入电脑端设备上的访问密码。中转和直连使用同一个访问密码。`
                : `连接 ${
                    accessPasswordHostLabel || selectedHost?.name || "选中设备"
                  } 前请输入电脑端设备上的访问密码。中转和直连使用同一个访问密码。`}
            </Text>
            <TextInput
              style={styles.input}
              value={accessPasswordDraft}
              onChangeText={setAccessPasswordDraft}
              secureTextEntry
              placeholder="访问密码"
              placeholderTextColor={theme.textMuted}
            />
            <Pressable
              onPress={() => setRememberAccessPassword((value) => !value)}
              style={styles.rememberRow}
            >
              <View
                style={[
                  styles.checkboxOuter,
                  rememberAccessPassword ? styles.checkboxOuterChecked : null,
                ]}
              >
                {rememberAccessPassword ? (
                  <View style={styles.checkboxInner} />
                ) : null}
              </View>
              <Text style={styles.rememberText}>保存到本机</Text>
            </Pressable>

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setShowAccessPasswordModal(false);
                  setPendingDirectConnect(null);
                  setAccessPasswordHostKey("");
                  setAccessPasswordHostLabel("");
                }}
                style={styles.modalGhostButton}
              >
                <Text style={styles.modalGhostButtonText}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleConfirmAccessPassword()}
                style={[styles.primaryButton, styles.modalPrimaryButton]}
              >
                <Text style={styles.primaryButtonText}>连接</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    scroll: {
      flex: 1,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.spaceLg,
      paddingTop: theme.spaceSm,
      paddingBottom: theme.spaceXl * 2,
    },
    containerCentered: {
      justifyContent: "center",
    },
    surface: {
      width: "100%",
      maxWidth: 420,
      alignSelf: "center",
      gap: theme.spaceMd,
    },
    formSection: {
      width: "100%",
      gap: theme.spaceMd,
    },
    formSectionCentered: {
      justifyContent: "center",
    },
    formTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: "700",
      textAlign: "center",
    },
    formMetaText: {
      marginTop: -theme.spaceXs,
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
    },
    formGroup: {
      gap: theme.spaceXs,
    },
    fieldLabel: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: "600",
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },
    modeSwitch: {
      flexDirection: "row",
      gap: theme.spaceSm,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 999,
      padding: 4,
      backgroundColor: theme.panelAlt,
    },
    modeTab: {
      flex: 1,
      borderWidth: 0,
      borderRadius: 999,
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    modeTabActive: {
      backgroundColor: theme.brandTeal,
    },
    modeTabText: {
      color: theme.textMuted,
      fontWeight: "600",
    },
    modeTabTextActive: {
      color: "#ffffff",
    },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 26,
      backgroundColor: theme.panelAlt,
      color: theme.text,
      paddingHorizontal: theme.spaceMd,
      minHeight: 52,
      fontSize: 14,
    },
    primaryButton: {
      borderRadius: 999,
      backgroundColor: theme.brandTeal,
      minHeight: 54,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spaceLg,
    },
    buttonDisabled: {
      opacity: 0.58,
    },
    primaryButtonText: {
      color: "#ffffff",
      fontWeight: "700",
      fontSize: 16,
    },
    utilityButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panelAlt,
      minHeight: 54,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spaceMd,
    },
    utilityButtonInline: {
      flex: 1,
    },
    utilityButtonText: {
      color: theme.text,
      fontSize: 13,
      fontWeight: "600",
    },
    inlineActionsRow: {
      flexDirection: "row",
      gap: theme.spaceSm,
    },
    hostList: {
      gap: theme.spaceSm,
    },
    hostItem: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 24,
      backgroundColor: theme.panelAlt,
      paddingHorizontal: theme.spaceSm + 2,
      paddingVertical: theme.spaceSm,
      gap: theme.spaceXs,
    },
    hostItemSelected: {
      borderColor: theme.brandTeal,
      backgroundColor: theme.panel,
    },
    hostItemMain: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spaceSm,
    },
    hostDot: {
      width: 9,
      height: 9,
      borderRadius: 999,
      backgroundColor: theme.brandTeal,
    },
    hostName: {
      flex: 1,
      color: theme.text,
      fontWeight: "700",
      fontSize: 14,
    },
    hostModeBadge: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: "600",
      textTransform: "uppercase",
    },
    hostItemMeta: {
      gap: 2,
      paddingLeft: 18,
    },
    hostMetaText: {
      color: theme.textMuted,
      fontSize: 12,
    },
    hostMetaWarnText: {
      color: theme.warning,
    },
    emptyText: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.42)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spaceLg,
    },
    modalCard: {
      width: "100%",
      maxWidth: 380,
      borderRadius: 30,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      paddingHorizontal: theme.spaceLg,
      paddingVertical: theme.spaceLg,
      gap: theme.spaceMd,
    },
    modalTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: "700",
      textAlign: "center",
    },
    modalHint: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
    },
    rememberRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spaceSm,
      paddingVertical: 2,
    },
    checkboxOuter: {
      width: 20,
      height: 20,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panelAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxOuterChecked: {
      borderColor: theme.brandTeal,
      backgroundColor: theme.brandTeal,
    },
    checkboxInner: {
      width: 8,
      height: 8,
      borderRadius: 999,
      backgroundColor: "#ffffff",
    },
    rememberText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: "600",
    },
    modalActions: {
      flexDirection: "row",
      gap: theme.spaceSm,
    },
    modalGhostButton: {
      flex: 1,
      minHeight: 54,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panelAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    modalGhostButtonText: {
      color: theme.textMuted,
      fontSize: 15,
      fontWeight: "600",
    },
    modalPrimaryButton: {
      flex: 1,
    },
    bottomTextAction: {
      alignSelf: "center",
      paddingVertical: theme.spaceXs,
      paddingHorizontal: theme.spaceSm,
    },
    bottomTextActionText: {
      color: theme.brandTeal,
      fontSize: 13,
      fontWeight: "600",
      textAlign: "center",
    },
    bottomDock: {
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      paddingTop: theme.spaceXs,
      paddingBottom: theme.spaceSm,
      paddingHorizontal: theme.spaceLg,
      backgroundColor: theme.bg,
    },
  });
