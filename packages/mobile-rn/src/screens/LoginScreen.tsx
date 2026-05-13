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
  type HostItem,
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
const DEFAULT_CONTROL_PLANE_URL = "https://relay.oneceo.ai";

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

  const controlPlaneUrl = DEFAULT_CONTROL_PLANE_URL;
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountMode, setAccountMode] = useState<AccountMode>("login");
  const [accountToken, setAccountToken] = useState("");
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [hosts, setHosts] = useState<HostItem[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [savedAccessPassword, setSavedAccessPassword] = useState("");
  const [accessPasswordDraft, setAccessPasswordDraft] = useState("");
  const [rememberAccessPassword, setRememberAccessPassword] = useState(true);
  const [showAccessPasswordModal, setShowAccessPasswordModal] = useState(false);
  const [relayBusy, setRelayBusy] = useState(false);
  const [showDirectAdvanced, setShowDirectAdvanced] = useState(false);
  const [recentServers, setRecentServers] = useState<string[]>([]);

  const selectedHost = useMemo(
    () => hosts.find((item) => item.id === selectedHostId) ?? null,
    [hosts, selectedHostId],
  );
  const hasAccountToken = accountToken.trim().length > 0;
  const loginMode: ForwardMode =
    route.params?.mode === "direct" || route.params?.selectedHostUrl
      ? "direct"
      : "relay";
  const showRelayDevicePage = loginMode === "relay" && hasAccountToken;
  const showRelayBottomSwitch = loginMode === "relay";

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
        savedAccountToken,
        savedAccountEmail,
        savedSelectedHostId,
        savedRelayPassword,
        savedRecent,
      ] = await Promise.all([
        getSecureItem(secureStorageKeys.directServerUrl),
        getSecureItem(secureStorageKeys.directUsername),
        getSecureItem(secureStorageKeys.directPassword),
        getSecureItem(secureStorageKeys.controlPlaneAccessToken),
        getSecureItem(secureStorageKeys.controlPlaneAccountEmail),
        getSecureItem(secureStorageKeys.selectedRelayDeviceId),
        getSecureItem(secureStorageKeys.relayPassword),
        getSecureItem(secureStorageKeys.recentDirectServers),
      ]);

      if (savedDirect?.trim()) setDirectServerUrl(savedDirect);
      if (savedDirectUsername?.trim()) setDirectUsername(savedDirectUsername);
      if (savedDirectPassword?.trim()) setDirectPassword(savedDirectPassword);
      if (savedAccountToken?.trim()) setAccountToken(savedAccountToken);
      if (savedAccountEmail?.trim()) setAccountEmail(savedAccountEmail);
      if (savedSelectedHostId?.trim()) setSelectedHostId(savedSelectedHostId);
      if (savedRelayPassword?.trim()) {
        setSavedAccessPassword(savedRelayPassword);
      }
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
      if (!accessPassword.trim()) {
        Alert.alert("缺少访问密码", "请输入桌面端设置的访问密码");
        return;
      }

      const target = resolveForwardingTarget({
        mode: "relay",
        controlPlaneUrl,
        relayWsUrl: deriveRelayWsUrl(controlPlaneUrl),
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
        deriveRelayWsUrl(controlPlaneUrl),
      );
      await setSecureItem(
        secureStorageKeys.relayUsername,
        selectedHost.relayUsername,
      );
      await setSecureItem(secureStorageKeys.relayPassword, accessPassword);
      await setSecureItem(
        secureStorageKeys.selectedRelayDeviceId,
        selectedHost.id,
      );
      navigation.navigate("Console", target);
    } catch (error) {
      Alert.alert(
        "打开失败",
        error instanceof Error ? error.message : "未知错误",
      );
    }
  };

  const handleRelayConnectPress = () => {
    if (!selectedHost) {
      Alert.alert("请选择主机", "先选择要连接的电脑");
      return;
    }

    setAccessPasswordDraft(savedAccessPassword);
    setRememberAccessPassword(Boolean(savedAccessPassword));
    setShowAccessPasswordModal(true);
  };

  const handleConfirmRelayPassword = async () => {
    const password = accessPasswordDraft.trim();
    if (!password) {
      Alert.alert("缺少访问密码", "请输入桌面端设置的访问密码");
      return;
    }

    if (rememberAccessPassword) {
      await setSecureItem(secureStorageKeys.relayPassword, password);
      setSavedAccessPassword(password);
    } else {
      await setSecureItem(secureStorageKeys.relayPassword, "");
      setSavedAccessPassword("");
    }

    setShowAccessPasswordModal(false);
    setAccessPasswordDraft("");
    void openRelayConsole(password);
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
                onPress={() =>
                  navigation.push("SearchHosts", {
                    currentServerUrl: directServerUrl,
                    recentServers,
                    scanPrefix:
                      getSubnetPrefixFromUrl(directServerUrl) ?? "192.168.1",
                    scanPort: getPortFromUrl(directServerUrl),
                  })
                }
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
        onRequestClose={() => setShowAccessPasswordModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>输入访问密码</Text>
            <Text style={styles.modalHint}>
              连接 {selectedHost?.name ?? "选中设备"} 前请输入桌面端访问密码。
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
                onPress={() => setShowAccessPasswordModal(false)}
                style={styles.modalGhostButton}
              >
                <Text style={styles.modalGhostButtonText}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleConfirmRelayPassword()}
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
