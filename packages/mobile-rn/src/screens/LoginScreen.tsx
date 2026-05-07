import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
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
import {
  type LanScanResult,
  scanLanServers,
  smartScanLanServers,
} from "../lib/connection/lanScanner";
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

export function LoginScreen({ navigation }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [directServerUrl, setDirectServerUrl] = useState(
    "http://127.0.0.1:45731",
  );
  const [directUsername, setDirectUsername] = useState("mobiletest");
  const [directPassword, setDirectPassword] = useState("mobiletest123");

  const [controlPlaneUrl, setControlPlaneUrl] = useState(
    "https://agentline.com",
  );
  const [relayWsUrl, setRelayWsUrl] = useState("wss://relay.agentline.com/ws");
  const [relayUsername, setRelayUsername] = useState("");
  const [relayPassword, setRelayPassword] = useState("");

  const [scanPrefix, setScanPrefix] = useState("192.168.1");
  const [scanPort, setScanPort] = useState("45731");
  const [scanAdvanced, setScanAdvanced] = useState(false);
  const [entryMode, setEntryMode] = useState<ForwardMode>("direct");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [scanResults, setScanResults] = useState<LanScanResult[]>([]);
  const [recentServers, setRecentServers] = useState<string[]>([]);

  useEffect(() => {
    const bootstrap = async () => {
      const [
        savedDirect,
        savedDirectUsername,
        savedDirectPassword,
        savedRelay,
        savedRecent,
      ] = await Promise.all([
        getSecureItem(secureStorageKeys.directServerUrl),
        getSecureItem(secureStorageKeys.directUsername),
        getSecureItem(secureStorageKeys.directPassword),
        getSecureItem(secureStorageKeys.controlPlaneUrl),
        getSecureItem(secureStorageKeys.recentDirectServers),
      ]);
      const [savedRelayWs, savedRelayUsername, savedRelayPassword] =
        await Promise.all([
          getSecureItem(secureStorageKeys.relayWsUrl),
          getSecureItem(secureStorageKeys.relayUsername),
          getSecureItem(secureStorageKeys.relayPassword),
        ]);

      if (savedDirect?.trim()) setDirectServerUrl(savedDirect);
      if (savedDirectUsername?.trim()) setDirectUsername(savedDirectUsername);
      if (savedDirectPassword?.trim()) setDirectPassword(savedDirectPassword);
      if (savedRelay?.trim()) setControlPlaneUrl(savedRelay);
      if (savedRelayWs?.trim()) setRelayWsUrl(savedRelayWs);
      if (savedRelayUsername?.trim()) setRelayUsername(savedRelayUsername);
      if (savedRelayPassword?.trim()) setRelayPassword(savedRelayPassword);
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
    };

    void bootstrap();
  }, []);

  const knownHosts = useMemo(
    () => dedupeKnownHosts(recentServers, scanResults),
    [recentServers, scanResults],
  );

  const saveRecent = async (url: string) => {
    const deduped = [url, ...recentServers.filter((x) => x !== url)].slice(
      0,
      10,
    );
    setRecentServers(deduped);
    await setSecureItem(
      secureStorageKeys.recentDirectServers,
      JSON.stringify(deduped),
    );
  };

  const openDirectConsole = async (serverUrl = directServerUrl) => {
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
  };

  const openRelayConsole = async () => {
    try {
      if (!controlPlaneUrl.trim()) {
        Alert.alert("缺少地址", "请填写中转服务地址");
        return;
      }

      const target = resolveForwardingTarget({
        mode: "relay",
        controlPlaneUrl,
        relayWsUrl,
        relayUsername,
        relayPassword,
        themeMode,
      });
      await setSecureItem(secureStorageKeys.connectionMode, "relay");
      await setSecureItem(
        secureStorageKeys.controlPlaneUrl,
        controlPlaneUrl.trim(),
      );
      await setSecureItem(secureStorageKeys.relayWsUrl, relayWsUrl.trim());
      await setSecureItem(
        secureStorageKeys.relayUsername,
        relayUsername.trim().toLowerCase(),
      );
      await setSecureItem(secureStorageKeys.relayPassword, relayPassword);
      navigation.navigate("Console", target);
    } catch (error) {
      Alert.alert(
        "打开失败",
        error instanceof Error ? error.message : "未知错误",
      );
    }
  };

  const onSmartScan = async () => {
    const port = Number(scanPort.trim() || "45731");
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      Alert.alert("扫描失败", "端口必须是 1-65535");
      return;
    }

    setScanLoading(true);
    setScanResults([]);
    setScanProgress("正在搜索可连接的电脑...");
    try {
      const found = await smartScanLanServers({
        port,
        recentServers,
        onProgress: (progress) => {
          setScanProgress(
            progress.phase === "quick"
              ? `快速搜索 ${progress.scanned}/${progress.total}`
              : `扩展搜索 ${progress.scanned}/${progress.total}`,
          );
        },
      });
      setScanResults(found);
      if (found.length === 1 && found[0]) {
        setDirectServerUrl(found[0].baseUrl);
        await saveRecent(found[0].baseUrl);
      }
    } catch {
      Alert.alert("扫描失败", "请重试");
    } finally {
      setScanLoading(false);
      setScanProgress("");
    }
  };

  const onManualScan = async () => {
    const prefix = scanPrefix.trim();
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(prefix)) {
      Alert.alert("扫描失败", "网段格式应为 192.168.1");
      return;
    }

    const port = Number(scanPort.trim() || "45731");
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      Alert.alert("扫描失败", "端口必须是 1-65535");
      return;
    }

    setScanLoading(true);
    setScanResults([]);
    setScanProgress("正在扫描指定网段...");
    try {
      const found = await scanLanServers(prefix, port);
      setScanResults(found);
    } catch {
      Alert.alert("扫描失败", "请重试");
    } finally {
      setScanLoading(false);
      setScanProgress("");
    }
  };

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
            {knownHosts.length > 0 ? "已保存主机" : "选择连接方式"}
          </Text>

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
            onPress={() => void onSmartScan()}
            disabled={scanLoading}
          >
            <Text style={styles.utilityButtonText}>
              {scanLoading ? "正在搜索..." : "自动搜索局域网主机"}
            </Text>
          </Pressable>

          {scanProgress ? (
            <Text style={styles.statusText}>{scanProgress}</Text>
          ) : null}

          <Text style={styles.sectionSubtitle}>添加新主机</Text>

          <Pressable
            style={[
              styles.modeOption,
              entryMode === "relay" ? styles.modeOptionActive : null,
            ]}
            onPress={() => setEntryMode("relay")}
          >
            <Text style={styles.modeOptionTitle}>通过中继连接</Text>
            <Text style={styles.modeOptionDesc}>
              通过中继服务器从任意位置连接，无需端口转发。
            </Text>
          </Pressable>

          {entryMode === "relay" ? (
            <View style={styles.formCard}>
              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>控制平面地址</Text>
                <TextInput
                  style={styles.input}
                  value={controlPlaneUrl}
                  onChangeText={setControlPlaneUrl}
                  autoCapitalize="none"
                  placeholder="https://agentline.com"
                  placeholderTextColor={theme.textMuted}
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>Relay WebSocket</Text>
                <TextInput
                  style={styles.input}
                  value={relayWsUrl}
                  onChangeText={setRelayWsUrl}
                  autoCapitalize="none"
                  placeholder="wss://relay.agentline.com/ws"
                  placeholderTextColor={theme.textMuted}
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>用户名</Text>
                <TextInput
                  style={styles.input}
                  value={relayUsername}
                  onChangeText={setRelayUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="relay 用户名"
                  placeholderTextColor={theme.textMuted}
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>密码</Text>
                <TextInput
                  style={styles.input}
                  value={relayPassword}
                  onChangeText={setRelayPassword}
                  placeholder="relay 密码"
                  placeholderTextColor={theme.textMuted}
                  secureTextEntry
                />
              </View>
              <Pressable
                style={styles.primaryButton}
                onPress={() => void openRelayConsole()}
              >
                <Text style={styles.primaryButtonText}>连接</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            style={[
              styles.modeOption,
              entryMode === "direct" ? styles.modeOptionActive : null,
            ]}
            onPress={() => setEntryMode("direct")}
          >
            <Text style={styles.modeOptionTitle}>直接连接</Text>
            <Text style={styles.modeOptionDesc}>
              通过 WebSocket 地址直接连接，适用于局域网或 Tailscale。
            </Text>
          </Pressable>

          {entryMode === "direct" ? (
            <View style={styles.formCard}>
              <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>电脑端地址</Text>
                <TextInput
                  style={styles.input}
                  value={directServerUrl}
                  onChangeText={setDirectServerUrl}
                  autoCapitalize="none"
                  placeholder="http://127.0.0.1:45731"
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
                    placeholder="端口（默认 45731）"
                    placeholderTextColor={theme.textMuted}
                  />
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => void onManualScan()}
                    disabled={scanLoading}
                  >
                    <Text style={styles.secondaryButtonText}>扫描这个网段</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.footerHint}>
            可优先选择上方已保存的主机，ADB 调试和模拟器场景优先使用
            `127.0.0.1:45731`。
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
      maxWidth: 360,
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
    hostList: {
      gap: theme.spaceSm,
    },
    hostItem: {
      gap: theme.spaceXs,
      padding: theme.spaceMd,
      borderRadius: theme.radiusMd,
      backgroundColor: theme.panelAlt,
      borderWidth: 1,
      borderColor: theme.borderSoft,
    },
    hostItemMain: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spaceSm,
    },
    hostDot: {
      width: 8,
      height: 8,
      borderRadius: 999,
      backgroundColor: theme.success,
    },
    hostName: {
      color: theme.text,
      fontSize: 14,
      fontWeight: "500",
      flex: 1,
    },
    hostModeBadge: {
      color: theme.textMuted,
      fontSize: 11,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: theme.panelAlt,
      overflow: "hidden",
    },
    hostItemMeta: {
      paddingLeft: 16,
      gap: 2,
    },
    hostMetaText: {
      color: theme.textMuted,
      fontSize: 11,
    },
    emptyText: {
      color: theme.textSecondary,
      fontSize: 14,
      lineHeight: 21,
      textAlign: "center",
    },
    utilityButton: {
      paddingVertical: theme.spaceMd,
      alignItems: "center",
    },
    utilityButtonText: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: "500",
    },
    statusText: {
      color: theme.textMuted,
      fontSize: 12,
      textAlign: "center",
    },
    modeOption: {
      gap: theme.spaceXs,
      padding: theme.spaceMd,
      borderRadius: theme.radiusMd,
      backgroundColor: theme.panelAlt,
      borderWidth: 1,
      borderColor: theme.borderSoft,
    },
    modeOptionActive: {
      borderColor: theme.brandTeal,
    },
    modeOptionTitle: {
      color: theme.text,
      fontSize: 15,
      fontWeight: "500",
    },
    modeOptionDesc: {
      color: theme.textSecondary,
      fontSize: 13,
      lineHeight: 20,
    },
    formCard: {
      gap: theme.spaceSm,
      marginTop: -4,
    },
    formGroup: {
      gap: 6,
    },
    fieldLabel: {
      color: theme.textMuted,
      fontSize: 12,
    },
    input: {
      backgroundColor: theme.input,
      borderColor: theme.borderInput,
      borderWidth: 1,
      borderRadius: theme.radiusMd,
      color: theme.text,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    primaryButton: {
      backgroundColor: theme.brandTeal,
      borderRadius: theme.radiusMd,
      paddingVertical: 14,
    },
    primaryButtonText: {
      color: "#f3fbf8",
      textAlign: "center",
      fontWeight: "800",
      fontSize: 15,
    },
    secondaryButton: {
      backgroundColor: theme.input,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: theme.radiusMd,
      paddingVertical: 12,
    },
    secondaryButtonText: {
      color: theme.text,
      textAlign: "center",
      fontWeight: "700",
      fontSize: 14,
    },
    advancedPane: {
      gap: theme.spaceSm,
    },
    textAction: {
      alignItems: "flex-start",
      paddingVertical: theme.spaceXs,
    },
    textActionText: {
      color: theme.textSecondary,
      fontSize: 13,
    },
    footerHint: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 20,
      textAlign: "center",
      marginTop: theme.spaceLg,
    },
  });
