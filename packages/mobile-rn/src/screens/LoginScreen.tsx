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
import { resolveForwardingTarget } from "../lib/forwarding/layer";
import {
  getSecureItem,
  secureStorageKeys,
  setSecureItem,
} from "../lib/storage/secureStorage";
import type { RootStackParamList } from "../navigation/types";
import { theme } from "../styles/theme";

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
  const [relayExpanded, setRelayExpanded] = useState(false);
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
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>A</Text>
          </View>
          <Text style={styles.title}>AgentLine</Text>
          <Text style={styles.subtitle}>
            在同一页里发现、保存并连接你的桌面控制端。
          </Text>
        </View>

        <View style={styles.band}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>快速连接</Text>
              <Text style={styles.sectionHint}>
                优先适配 ADB 反向代理，也支持同网段自动搜索。
              </Text>
            </View>
            <Pressable
              style={styles.inlineAction}
              onPress={() => void onSmartScan()}
              disabled={scanLoading}
            >
              <Text style={styles.inlineActionText}>
                {scanLoading ? "搜索中" : "自动搜索"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.callout}>
            <Text style={styles.calloutTitle}>当前推荐</Text>
            <Text style={styles.calloutBody}>
              模拟器和 USB 调试优先使用
              127.0.0.1:45731。局域网场景可改成电脑实际 IP。
            </Text>
          </View>

          {scanProgress ? (
            <Text style={styles.progressText}>{scanProgress}</Text>
          ) : null}

          {knownHosts.length > 0 ? (
            <View style={styles.hostList}>
              {knownHosts.map((host) => (
                <Pressable
                  key={host.url}
                  style={styles.hostRow}
                  onPress={() => {
                    setDirectServerUrl(host.url);
                    void openDirectConsole(host.url);
                  }}
                >
                  <View style={styles.hostMeta}>
                    <Text style={styles.hostLabel}>{host.label}</Text>
                    <Text style={styles.hostUrl}>{host.url}</Text>
                  </View>
                  <View style={styles.hostBadge}>
                    <Text style={styles.hostBadgeText}>
                      {host.source === "scan" ? "发现" : "最近"}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>
              还没有已发现主机。你可以先自动搜索，也可以直接手填。
            </Text>
          )}
        </View>

        <View style={styles.band}>
          <Text style={styles.sectionTitle}>直接连接</Text>
          <Text style={styles.sectionHint}>
            这里同时承担“保存主机”和“立即进入”，不再跳到另一套模板。
          </Text>

          <TextInput
            style={styles.input}
            value={directServerUrl}
            onChangeText={setDirectServerUrl}
            autoCapitalize="none"
            placeholder="http://127.0.0.1:45731"
            placeholderTextColor={theme.textMuted}
          />
          <TextInput
            style={styles.input}
            value={directUsername}
            onChangeText={setDirectUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="直连用户名"
            placeholderTextColor={theme.textMuted}
          />
          <TextInput
            style={styles.input}
            value={directPassword}
            onChangeText={setDirectPassword}
            placeholder="直连密码"
            placeholderTextColor={theme.textMuted}
            secureTextEntry
          />

          <Pressable
            style={styles.primaryButton}
            onPress={() => void openDirectConsole()}
          >
            <Text style={styles.primaryButtonText}>进入电脑控制台</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={() => setScanAdvanced((value) => !value)}
          >
            <Text style={styles.secondaryButtonText}>
              {scanAdvanced ? "收起网段搜索" : "展开网段搜索"}
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

        <View style={styles.band}>
          <Pressable
            style={styles.sectionHeaderButton}
            onPress={() => setRelayExpanded((value) => !value)}
          >
            <View>
              <Text style={styles.sectionTitle}>中转连接</Text>
              <Text style={styles.sectionHint}>
                需要跨网段时再展开，避免把主路径做复杂。
              </Text>
            </View>
            <Text style={styles.chevron}>
              {relayExpanded ? "收起" : "展开"}
            </Text>
          </Pressable>

          {relayExpanded ? (
            <View style={styles.relayPane}>
              <TextInput
                style={styles.input}
                value={controlPlaneUrl}
                onChangeText={setControlPlaneUrl}
                autoCapitalize="none"
                placeholder="https://agentline.com"
                placeholderTextColor={theme.textMuted}
              />
              <TextInput
                style={styles.input}
                value={relayWsUrl}
                onChangeText={setRelayWsUrl}
                autoCapitalize="none"
                placeholder="wss://relay.agentline.com/ws"
                placeholderTextColor={theme.textMuted}
              />
              <TextInput
                style={styles.input}
                value={relayUsername}
                onChangeText={setRelayUsername}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="relay 用户名"
                placeholderTextColor={theme.textMuted}
              />
              <TextInput
                style={styles.input}
                value={relayPassword}
                onChangeText={setRelayPassword}
                placeholder="relay 密码"
                placeholderTextColor={theme.textMuted}
                secureTextEntry
              />
              <Pressable
                style={styles.secondaryButton}
                onPress={() => void openRelayConsole()}
              >
                <Text style={styles.secondaryButtonText}>通过中转进入</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  container: {
    paddingHorizontal: theme.spaceLg,
    paddingTop: theme.spaceLg,
    paddingBottom: theme.spaceLg * 2,
    gap: theme.spaceLg,
  },
  hero: {
    gap: theme.spaceSm,
    paddingTop: theme.spaceSm,
  },
  heroBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f2e27",
    borderWidth: 1,
    borderColor: "#174236",
  },
  heroBadgeText: {
    color: "#33d6a6",
    fontSize: 24,
    fontWeight: "800",
  },
  title: {
    color: theme.text,
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: theme.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  band: {
    gap: theme.spaceSm,
    padding: theme.spaceMd,
    backgroundColor: theme.panel,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.spaceSm,
  },
  sectionHeaderButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.spaceSm,
  },
  sectionTitle: {
    color: theme.text,
    fontSize: 17,
    fontWeight: "700",
  },
  sectionHint: {
    color: theme.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  inlineAction: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.panelAlt,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    borderColor: theme.border,
  },
  inlineActionText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "700",
  },
  callout: {
    padding: theme.spaceSm,
    borderRadius: theme.radiusSm,
    backgroundColor: "#1a2421",
    borderWidth: 1,
    borderColor: "#263934",
    gap: 4,
  },
  calloutTitle: {
    color: "#8ee7c4",
    fontSize: 12,
    fontWeight: "700",
  },
  calloutBody: {
    color: theme.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  progressText: {
    color: theme.warning,
    fontSize: 12,
  },
  hostList: {
    gap: theme.spaceSm,
  },
  hostRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spaceSm,
    padding: theme.spaceSm,
    borderRadius: theme.radiusSm,
    backgroundColor: theme.panelAlt,
    borderWidth: 1,
    borderColor: theme.borderSoft,
  },
  hostMeta: {
    flex: 1,
    gap: 2,
  },
  hostLabel: {
    color: theme.text,
    fontSize: 15,
    fontWeight: "700",
  },
  hostUrl: {
    color: theme.textMuted,
    fontSize: 12,
  },
  hostBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#23303b",
  },
  hostBadgeText: {
    color: theme.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  emptyText: {
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radiusSm,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  primaryButton: {
    backgroundColor: "#33d6a6",
    borderRadius: theme.radiusSm,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: "#0d1b17",
    textAlign: "center",
    fontWeight: "800",
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radiusSm,
    paddingVertical: 11,
  },
  secondaryButtonText: {
    color: theme.text,
    textAlign: "center",
    fontWeight: "700",
    fontSize: 14,
  },
  advancedPane: {
    gap: theme.spaceSm,
    marginTop: 2,
  },
  relayPane: {
    gap: theme.spaceSm,
    marginTop: theme.spaceSm,
  },
  chevron: {
    color: theme.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
});
