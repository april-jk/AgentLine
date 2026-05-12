import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
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
  type HostItem,
  normalizeHttpBaseUrl,
} from "../lib/api/client";
import type { LanScanResult } from "../lib/connection/lanScanner";
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

type KnownHost = {
  url: string;
  label: string;
  source: "recent" | "scan";
  detail?: string;
};

function normalizeLabelFromUrl(url: string): string {
  try {
    const match = url.match(/^https?:\/\/([^/:]+)/);
    if (match?.[1]) return match[1];
  } catch {
    // fall through to raw normalization
  }

  return url.replace(/^https?:\/\//, "");
}

function getPortFromUrl(url: string): string {
  const match = url.match(/:(\d+)(?:\/|$)/);
  return match?.[1] ?? String(DEFAULT_DESKTOP_DISCOVERY_PORT);
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

function dedupeKnownHosts(
  recentServers: string[],
  scanResults: LanScanResult[],
): KnownHost[] {
  const seen = new Set<string>();
  const items: KnownHost[] = [];

  for (const url of recentServers) {
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({
      url,
      label: normalizeLabelFromUrl(url),
      source: "recent",
      detail: "最近连接",
    });
  }

  for (const item of scanResults) {
    if (seen.has(item.baseUrl)) continue;
    seen.add(item.baseUrl);
    items.push({
      url: item.baseUrl,
      label: item.host,
      source: "scan",
      detail: `${item.host}:${String(item.port)}`,
    });
  }

  return items;
}

function deriveRelayWsUrl(controlPlaneUrl: string): string {
  try {
    const normalized = normalizeHttpBaseUrl(controlPlaneUrl)
      .replace(/\/+$/, "")
      .replace(/^http:\/\//, "ws://")
      .replace(/^https:\/\//, "wss://");
    return `${normalized}/ws`;
  } catch {
    return "wss://relay.oneceo.ai/ws";
  }
}

function statusColor(
  relayState: HostItem["relayState"],
  theme: AppTheme,
): string {
  if (relayState === "paired") return "#16a34a";
  if (relayState === "waiting") return "#f59e0b";
  return theme.textMuted;
}

export function LoginScreen({ navigation, route }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [directServerUrl, setDirectServerUrl] = useState(
    `http://127.0.0.1:${String(DEFAULT_DESKTOP_DISCOVERY_PORT)}`,
  );
  const [directUsername, setDirectUsername] = useState("mobiletest");
  const [directPassword, setDirectPassword] = useState("mobiletest123");

  const [controlPlaneUrl, setControlPlaneUrl] = useState(
    "https://relay.oneceo.ai",
  );
  const [relayWsUrl, setRelayWsUrl] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountMode, setAccountMode] = useState<AccountMode>("login");
  const [accountToken, setAccountToken] = useState("");
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [hosts, setHosts] = useState<HostItem[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [accessPassword, setAccessPassword] = useState("");
  const [relayBusy, setRelayBusy] = useState(false);
  const [showRelayAdvanced, setShowRelayAdvanced] = useState(false);

  const [scanPrefix, setScanPrefix] = useState("192.168.1");
  const [scanPort, setScanPort] = useState(
    String(DEFAULT_DESKTOP_DISCOVERY_PORT),
  );
  const [scanAdvanced, setScanAdvanced] = useState(false);
  const [entryMode, setEntryMode] = useState<ForwardMode>("relay");
  const [recentServers, setRecentServers] = useState<string[]>([]);

  const selectedHost = useMemo(
    () => hosts.find((item) => item.id === selectedHostId) ?? null,
    [hosts, selectedHostId],
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
          if (current && list.some((item) => item.id === current)) return current;
          return list[0]?.id ?? null;
        });
      } catch (error) {
        Alert.alert(
          "加载主机失败",
          error instanceof Error ? error.message : "无法获取设备列表",
        );
      } finally {
        setRelayBusy(false);
      }
    },
    [controlPlaneUrl],
  );

  useEffect(() => {
    const bootstrap = async () => {
      const [
        savedDirect,
        savedDirectUsername,
        savedDirectPassword,
        savedControlPlaneUrl,
        savedRelayWs,
        savedAccountToken,
        savedAccountEmail,
        savedSelectedHostId,
        savedRelayPassword,
        savedRecent,
      ] = await Promise.all([
        getSecureItem(secureStorageKeys.directServerUrl),
        getSecureItem(secureStorageKeys.directUsername),
        getSecureItem(secureStorageKeys.directPassword),
        getSecureItem(secureStorageKeys.controlPlaneUrl),
        getSecureItem(secureStorageKeys.relayWsUrl),
        getSecureItem(secureStorageKeys.controlPlaneAccessToken),
        getSecureItem(secureStorageKeys.controlPlaneAccountEmail),
        getSecureItem(secureStorageKeys.selectedRelayDeviceId),
        getSecureItem(secureStorageKeys.relayPassword),
        getSecureItem(secureStorageKeys.recentDirectServers),
      ]);

      if (savedDirect?.trim()) setDirectServerUrl(savedDirect);
      if (savedDirectUsername?.trim()) setDirectUsername(savedDirectUsername);
      if (savedDirectPassword?.trim()) setDirectPassword(savedDirectPassword);
      if (savedControlPlaneUrl?.trim()) setControlPlaneUrl(savedControlPlaneUrl);
      if (savedRelayWs?.trim()) setRelayWsUrl(savedRelayWs);
      if (savedAccountToken?.trim()) setAccountToken(savedAccountToken);
      if (savedAccountEmail?.trim()) setAccountEmail(savedAccountEmail);
      if (savedSelectedHostId?.trim()) setSelectedHostId(savedSelectedHostId);
      if (savedRelayPassword?.trim()) setAccessPassword(savedRelayPassword);
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

      // Use persisted URL + token together to avoid startup race where token
      // triggers a fetch before controlPlaneUrl state has finished updating.
      if (savedControlPlaneUrl?.trim() && savedAccountToken?.trim()) {
        await loadRelayHosts(savedAccountToken, savedControlPlaneUrl);
      }
      setBootstrapDone(true);
    };

    void bootstrap();
  }, [loadRelayHosts]);

  const knownHosts = useMemo(
    () => dedupeKnownHosts(recentServers, []),
    [recentServers],
  );

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

  useEffect(() => {
    if (!bootstrapDone || !accountToken.trim()) return;
    void loadRelayHosts(accountToken);
  }, [accountToken, bootstrapDone, loadRelayHosts]);

  const openDirectConsole = useCallback(
    async (serverUrl = directServerUrl) => {
      try {
        if (!serverUrl.trim()) {
          Alert.alert("缺少地址", "请填写电脑端 AgentLine 地址");
          return;
        }
        if (!directUsername.trim()) {
          Alert.alert("缺少用户名", "请填写直连用户名");
          return;
        }

        const target = resolveForwardingTarget({
          mode: "direct",
          directServerUrl: serverUrl,
          directUsername,
          directPassword,
          themeMode,
        });
        await setSecureItem(secureStorageKeys.connectionMode, "direct");
        await setSecureItem(secureStorageKeys.directServerUrl, target.url);
        await setSecureItem(
          secureStorageKeys.directUsername,
          directUsername.trim(),
        );
        await setSecureItem(secureStorageKeys.directPassword, directPassword);
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
      directPassword,
      directServerUrl,
      directUsername,
      navigation,
      saveRecent,
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
      const baseUrl = normalizeHttpBaseUrl(controlPlaneUrl);
      const client = new ApiClient(baseUrl);
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
      setAccountToken(authResult.accessToken);
      setAccountPassword("");
      await loadRelayHosts(authResult.accessToken, baseUrl);
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

  const openRelayConsole = async () => {
    try {
      if (!selectedHost) {
        Alert.alert("请选择主机", "先选择要连接的电脑");
        return;
      }
      if (!accessPassword.trim()) {
        Alert.alert("缺少访问密码", "请输入桌面端设置的访问密码");
        return;
      }

      const target = resolveForwardingTarget({
        mode: "relay",
        controlPlaneUrl,
        relayWsUrl: relayWsUrl.trim() || deriveRelayWsUrl(controlPlaneUrl),
        relayUsername: selectedHost.relayUsername,
        relayPassword: accessPassword,
        themeMode,
      });

      await setSecureItem(secureStorageKeys.connectionMode, "relay");
      await setSecureItem(
        secureStorageKeys.controlPlaneUrl,
        normalizeHttpBaseUrl(controlPlaneUrl),
      );
      await setSecureItem(
        secureStorageKeys.relayWsUrl,
        relayWsUrl.trim() || deriveRelayWsUrl(controlPlaneUrl),
      );
      await setSecureItem(
        secureStorageKeys.relayUsername,
        selectedHost.relayUsername,
      );
      await setSecureItem(secureStorageKeys.relayPassword, accessPassword);
      await setSecureItem(secureStorageKeys.selectedRelayDeviceId, selectedHost.id);
      navigation.navigate("Console", target);
    } catch (error) {
      Alert.alert(
        "打开失败",
        error instanceof Error ? error.message : "未知错误",
      );
    }
  };

  useEffect(() => {
    const selectedHostUrl = route.params?.selectedHostUrl;
    if (!selectedHostUrl?.trim()) return;

    setDirectServerUrl(selectedHostUrl);
    void saveRecent(selectedHostUrl);

    if (route.params?.connectOnSelect) {
      void openDirectConsole(selectedHostUrl);
    }

    navigation.setParams({
      selectedHostUrl: undefined,
      connectOnSelect: undefined,
    });
  }, [
    navigation,
    openDirectConsole,
    route.params?.connectOnSelect,
    route.params?.selectedHostUrl,
    saveRecent,
  ]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.surface}>
          <View style={styles.logoBlock}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>A</Text>
            </View>
            <Text style={styles.logoWordmark}>
              <Text style={styles.logoWordmarkAccent}>Agent</Text>
              <Text style={styles.logoWordmarkBase}>Line</Text>
            </Text>
          </View>

          <Text style={styles.sectionSubtitle}>
            {entryMode === "relay" ? "平台账号连接" : "直接连接"}
          </Text>

          <View style={styles.modeSwitch}>
            <Pressable
              style={[
                styles.modeTab,
                entryMode === "relay" ? styles.modeTabActive : null,
              ]}
              onPress={() => setEntryMode("relay")}
            >
              <Text
                style={[
                  styles.modeTabText,
                  entryMode === "relay" ? styles.modeTabTextActive : null,
                ]}
              >
                平台账号
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.modeTab,
                entryMode === "direct" ? styles.modeTabActive : null,
              ]}
              onPress={() => setEntryMode("direct")}
            >
              <Text
                style={[
                  styles.modeTabText,
                  entryMode === "direct" ? styles.modeTabTextActive : null,
                ]}
              >
                局域网直连
              </Text>
            </Pressable>
          </View>

          {entryMode === "relay" ? (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>平台账号与设备</Text>
              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>控制平面地址</Text>
                <TextInput
                  style={styles.input}
                  value={controlPlaneUrl}
                  onChangeText={setControlPlaneUrl}
                  autoCapitalize="none"
                  placeholder="https://relay.oneceo.ai"
                  placeholderTextColor={theme.textMuted}
                />
              </View>
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
                style={styles.secondaryButton}
                onPress={() => void submitRelayAccount()}
                disabled={relayBusy}
              >
                <Text style={styles.secondaryButtonText}>
                  {relayBusy
                    ? "处理中..."
                    : accountMode === "register"
                      ? "注册并登录"
                      : "登录并加载设备"}
                </Text>
              </Pressable>
              {accountToken ? (
                <View style={styles.inlineActionsRow}>
                  <Pressable
                    style={styles.utilityButton}
                    onPress={() => void loadRelayHosts(accountToken)}
                  >
                    <Text style={styles.utilityButtonText}>刷新设备列表</Text>
                  </Pressable>
                  <Pressable
                    style={styles.utilityButton}
                    onPress={() => void clearRelayAccount()}
                  >
                    <Text style={styles.utilityButtonText}>退出账号</Text>
                  </Pressable>
                </View>
              ) : null}

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
                                { backgroundColor: statusColor(host.relayState, theme) },
                              ]}
                            />
                            <Text style={styles.hostName}>{host.name}</Text>
                            <Text style={styles.hostModeBadge}>{host.deviceType}</Text>
                          </View>
                          <View style={styles.hostItemMeta}>
                            <Text style={styles.hostMetaText}>
                              {host.relayUsername}
                            </Text>
                            <Text style={styles.hostMetaText}>
                              状态：{host.relayState}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.emptyText}>
                    {accountToken
                      ? "没有找到已绑定设备，请先在桌面端登录同一账号并保持在线。"
                      : "登录后会显示可连接的电脑。"}
                  </Text>
                )}
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>访问密码（桌面端设置）</Text>
                <TextInput
                  style={styles.input}
                  value={accessPassword}
                  onChangeText={setAccessPassword}
                  secureTextEntry
                  placeholder="访问密码"
                  placeholderTextColor={theme.textMuted}
                />
              </View>

              <Pressable
                style={styles.primaryButton}
                onPress={() => void openRelayConsole()}
              >
                <Text style={styles.primaryButtonText}>连接到选中设备</Text>
              </Pressable>

              <Pressable
                style={styles.textAction}
                onPress={() => setShowRelayAdvanced((value) => !value)}
              >
                <Text style={styles.textActionText}>
                  {showRelayAdvanced ? "隐藏高级选项" : "显示高级选项"}
                </Text>
              </Pressable>
              {showRelayAdvanced ? (
                <View style={styles.advancedPane}>
                  <TextInput
                    style={styles.input}
                    value={relayWsUrl}
                    onChangeText={setRelayWsUrl}
                    autoCapitalize="none"
                    placeholder={deriveRelayWsUrl(controlPlaneUrl)}
                    placeholderTextColor={theme.textMuted}
                  />
                  <Text style={styles.footerHint}>
                    默认会从控制平面地址自动推导 Relay WebSocket。
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {entryMode === "direct" ? (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>局域网直连</Text>

              {knownHosts.length > 0 ? (
                <View style={styles.hostList}>
                  {knownHosts.map((host) => (
                    <Pressable
                      key={host.url}
                      style={styles.hostItem}
                      onPress={() => {
                        setDirectServerUrl(host.url);
                        void openDirectConsole(host.url);
                      }}
                    >
                      <View style={styles.hostItemMain}>
                        <View style={styles.hostDot} />
                        <Text style={styles.hostName}>{host.label}</Text>
                        <Text style={styles.hostModeBadge}>direct</Text>
                      </View>
                      <View style={styles.hostItemMeta}>
                        <Text style={styles.hostMetaText}>{host.url}</Text>
                        <Text style={styles.hostMetaText}>
                          {host.detail ?? "最近连接"}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyText}>
                  还没有已保存主机。你可以先自动搜索，也可以手动添加。
                </Text>
              )}

              <Pressable
                style={styles.utilityButton}
                onPress={() =>
                  navigation.navigate("SearchHosts", {
                    currentServerUrl: directServerUrl,
                    recentServers,
                    scanPrefix:
                      getSubnetPrefixFromUrl(directServerUrl) ?? scanPrefix,
                    scanPort: getPortFromUrl(directServerUrl),
                  })
                }
              >
                <Text style={styles.utilityButtonText}>自动搜索局域网主机</Text>
              </Pressable>

              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>电脑端地址</Text>
                <TextInput
                  style={styles.input}
                  value={directServerUrl}
                  onChangeText={setDirectServerUrl}
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
              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>密码</Text>
                <TextInput
                  style={styles.input}
                  value={directPassword}
                  onChangeText={setDirectPassword}
                  placeholder="直连密码"
                  placeholderTextColor={theme.textMuted}
                  secureTextEntry
                />
              </View>
              <Pressable
                style={styles.primaryButton}
                onPress={() => void openDirectConsole()}
              >
                <Text style={styles.primaryButtonText}>连接</Text>
              </Pressable>
              <Pressable
                style={styles.textAction}
                onPress={() => setScanAdvanced((value) => !value)}
              >
                <Text style={styles.textActionText}>
                  {scanAdvanced ? "隐藏高级选项" : "显示高级选项"}
                </Text>
              </Pressable>
              {scanAdvanced ? (
                <View style={styles.advancedPane}>
                  <TextInput
                    style={styles.input}
                    value={scanPrefix}
                    onChangeText={setScanPrefix}
                    autoCapitalize="none"
                    placeholder="网段，例如 192.168.1"
                    placeholderTextColor={theme.textMuted}
                  />
                  <TextInput
                    style={styles.input}
                    value={scanPort}
                    onChangeText={setScanPort}
                    keyboardType="numeric"
                    placeholder={`端口（默认 ${String(
                      DEFAULT_DESKTOP_DISCOVERY_PORT,
                    )}）`}
                    placeholderTextColor={theme.textMuted}
                  />
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() =>
                      navigation.navigate("SearchHosts", {
                        currentServerUrl: directServerUrl,
                        recentServers,
                        scanPrefix:
                          getSubnetPrefixFromUrl(directServerUrl) ?? scanPrefix,
                        scanPort,
                      })
                    }
                  >
                    <Text style={styles.secondaryButtonText}>打开扫描窗口</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.footerHint}>
            推荐流程：平台账号登录 → 选择设备 → 输入桌面端访问密码。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    container: {
      paddingHorizontal: theme.spaceLg,
      paddingTop: theme.spaceLg,
      paddingBottom: theme.spaceXl * 2,
    },
    surface: {
      width: "100%",
      maxWidth: 380,
      alignSelf: "center",
      gap: theme.spaceMd,
    },
    logoBlock: {
      alignItems: "center",
      gap: theme.spaceMd,
      paddingTop: theme.spaceXl,
      paddingBottom: theme.spaceLg,
    },
    logoMark: {
      width: 44,
      height: 44,
      borderRadius: theme.radiusLg,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.panelAlt,
      borderWidth: 1,
      borderColor: theme.border,
    },
    logoMarkText: {
      color: theme.brandTeal,
      fontSize: 24,
      fontWeight: "800",
    },
    logoWordmark: {
      fontSize: 22,
      fontWeight: "800",
    },
    logoWordmarkAccent: {
      color: theme.brandTeal,
    },
    logoWordmarkBase: {
      color: theme.text,
    },
    sectionSubtitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "700",
      textAlign: "center",
    },
    modeSwitch: {
      flexDirection: "row",
      gap: theme.spaceSm,
    },
    modeTab: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: theme.radiusMd,
      paddingVertical: theme.spaceSm,
      alignItems: "center",
      backgroundColor: theme.panel,
    },
    modeTabActive: {
      backgroundColor: theme.brandTeal,
      borderColor: theme.brandTeal,
    },
    modeTabText: {
      color: theme.textMuted,
      fontWeight: "600",
    },
    modeTabTextActive: {
      color: "#ffffff",
    },
    formCard: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: theme.radiusLg,
      backgroundColor: theme.panel,
      padding: theme.spaceLg,
      gap: theme.spaceMd,
    },
    formTitle: {
      color: theme.text,
      fontSize: 16,
      fontWeight: "700",
    },
    formGroup: {
      gap: theme.spaceXs,
    },
    fieldLabel: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: "600",
    },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: theme.radiusMd,
      backgroundColor: theme.panelAlt,
      color: theme.text,
      paddingHorizontal: theme.spaceMd,
      paddingVertical: theme.spaceSm,
      fontSize: 14,
    },
    primaryButton: {
      borderRadius: theme.radiusMd,
      backgroundColor: theme.brandTeal,
      paddingVertical: theme.spaceSm,
      alignItems: "center",
    },
    primaryButtonText: {
      color: "#ffffff",
      fontWeight: "700",
      fontSize: 15,
    },
    secondaryButton: {
      borderRadius: theme.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panelAlt,
      paddingVertical: theme.spaceSm,
      alignItems: "center",
    },
    secondaryButtonText: {
      color: theme.text,
      fontWeight: "600",
      fontSize: 14,
    },
    utilityButton: {
      borderRadius: theme.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panelAlt,
      paddingVertical: theme.spaceSm,
      alignItems: "center",
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
      borderRadius: theme.radiusMd,
      backgroundColor: theme.panelAlt,
      padding: theme.spaceSm,
      gap: theme.spaceXs,
    },
    hostItemSelected: {
      borderColor: theme.brandTeal,
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
    },
    hostItemMeta: {
      gap: 2,
      paddingLeft: 18,
    },
    hostMetaText: {
      color: theme.textMuted,
      fontSize: 12,
    },
    emptyText: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    textAction: {
      alignItems: "center",
      paddingVertical: theme.spaceXs,
    },
    textActionText: {
      color: theme.brandTeal,
      fontWeight: "600",
      fontSize: 13,
    },
    advancedPane: {
      gap: theme.spaceSm,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: theme.radiusMd,
      padding: theme.spaceSm,
      backgroundColor: theme.panelAlt,
    },
    footerHint: {
      color: theme.textMuted,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
    },
  });
