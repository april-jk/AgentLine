import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
  type LanScanResult,
  scanLanServers,
  smartScanLanServers,
} from "../lib/connection/lanScanner";
import type { RootStackParamList } from "../navigation/types";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import type { AppTheme } from "../styles/theme";
import { useAppTheme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "SearchHosts">;

type KnownHost = {
  url: string;
  label: string;
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

function isRoutableLanPrefix(prefix: string): boolean {
  const match = prefix.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }
  const a = Number(match[1] ?? -1);
  const b = Number(match[2] ?? -1);
  const c = Number(match[3] ?? -1);
  if (![a, b, c].every((part) => Number.isInteger(part))) return false;
  if ([a, b, c].some((part) => part < 0 || part > 255)) return false;
  if (a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function normalizeSubnetPrefix(value: string): string {
  const match = value
    .trim()
    .replace(/\.$/, "")
    .match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})(?:\.\d{1,3})?$/);
  const prefix = match?.[1] ?? "";
  if (!isRoutableLanPrefix(prefix)) return "192.168.1";
  return prefix;
}

function dedupeKnownHosts(scanResults: LanScanResult[]): KnownHost[] {
  const seen = new Set<string>();
  const items: KnownHost[] = [];

  for (const item of scanResults) {
    if (seen.has(item.baseUrl)) continue;
    seen.add(item.baseUrl);
    items.push({
      url: item.baseUrl,
      label: item.host,
      detail: `${item.host}:${String(item.port)}`,
    });
  }

  return items;
}

function resolveSelectedHostUrl(
  currentSelected: string,
  currentServerUrl: string,
  scanResults: LanScanResult[],
): string {
  if (scanResults.length <= 0) {
    return currentServerUrl || currentSelected;
  }

  const urls = new Set(scanResults.map((item) => item.baseUrl));
  if (currentSelected && urls.has(currentSelected)) return currentSelected;
  if (currentServerUrl && urls.has(currentServerUrl)) return currentServerUrl;
  return scanResults[0]?.baseUrl ?? currentSelected;
}

export function SearchHostsScreen({ navigation, route }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const {
    currentServerUrl,
    recentServers,
    scanPrefix: initialPrefix,
    scanPort: initialPort,
  } = route.params;

  const [scanPrefix, setScanPrefix] = useState(initialPrefix);
  const [scanPort, setScanPort] = useState(initialPort);
  const [scanAdvanced, setScanAdvanced] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [scanResults, setScanResults] = useState<LanScanResult[]>([]);
  const [selectedHostUrl, setSelectedHostUrl] = useState(currentServerUrl);
  const effectiveScanPrefix = useMemo(
    () => normalizeSubnetPrefix(scanPrefix),
    [scanPrefix],
  );

  const knownHosts = useMemo(
    () => dedupeKnownHosts(scanResults),
    [scanResults],
  );

  useEffect(() => {
    void runSmartScan();
  }, []);

  const runSmartScan = async () => {
    const port = Number(
      scanPort.trim() || String(DEFAULT_DESKTOP_DISCOVERY_PORT),
    );
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setScanProgress("端口必须是 1-65535");
      return;
    }

    setScanLoading(true);
    setScanResults([]);
    setScanProgress("正在搜索可连接的电脑...");
    try {
      const found = await smartScanLanServers({
        port,
        recentServers,
        preferredSubnetPrefix: effectiveScanPrefix,
        onProgress: (progress) => {
          setScanProgress(
            `扫描 ${progress.subnetPrefix}.0/24 (${progress.scanned}/${progress.total})`,
          );
        },
      });
      setScanResults(found);
      setSelectedHostUrl((current) =>
        resolveSelectedHostUrl(current, currentServerUrl, found),
      );
      setScanProgress(
        found.length > 0
          ? `找到 ${String(found.length)} 台可连接电脑`
          : "没有找到可连接的电脑",
      );
    } catch {
      setScanProgress("搜索失败，请重试");
    } finally {
      setScanLoading(false);
    }
  };

  const runManualScan = async () => {
    const prefix = scanPrefix.trim().replace(/\.$/, "");
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(prefix)) {
      setScanProgress("网段格式应为 192.168.1");
      return;
    }
    if (!isRoutableLanPrefix(prefix)) {
      setScanProgress(
        "禁止扫描该网段，请输入可路由局域网网段（例如 192.168.1）",
      );
      return;
    }

    const port = Number(
      scanPort.trim() || String(DEFAULT_DESKTOP_DISCOVERY_PORT),
    );
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setScanProgress("端口必须是 1-65535");
      return;
    }

    setScanLoading(true);
    setScanResults([]);
    setScanProgress("正在扫描指定网段...");
    try {
      const found = await scanLanServers(prefix, port);
      setScanResults(found);
      setSelectedHostUrl((current) =>
        resolveSelectedHostUrl(current, currentServerUrl, found),
      );
      setScanProgress(
        found.length > 0
          ? `找到 ${String(found.length)} 台可连接电脑`
          : "没有找到可连接的电脑",
      );
    } catch {
      setScanProgress("扫描失败，请重试");
    } finally {
      setScanLoading(false);
    }
  };

  const applySelection = (connectOnSelect = false) => {
    if (!selectedHostUrl.trim()) return;
    navigation.popTo("Login", {
      mode: "direct",
      selectedHostUrl,
      connectOnSelect,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.surface}>
          <View style={styles.headerBlock}>
            <Text style={styles.title}>搜索局域网主机</Text>
            <Text style={styles.subtitle}>
              默认只扫描当前网段 {effectiveScanPrefix}
              .0/24。跨网段或复杂网络请使用高级扫描。
            </Text>
          </View>

          <View style={styles.selectedCard}>
            <Text style={styles.cardLabel}>当前选中主机</Text>
            <Text style={styles.selectedValue} numberOfLines={1}>
              {selectedHostUrl || "还没有选中主机"}
            </Text>
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              style={styles.primaryButton}
              onPress={() => void runSmartScan()}
              disabled={scanLoading}
            >
              {scanLoading ? (
                <ActivityIndicator color="#f3fbf8" />
              ) : (
                <Text style={styles.primaryButtonText}>开始自动搜索</Text>
              )}
            </Pressable>
            <Text style={styles.statusText}>
              当前自动扫描网段：{effectiveScanPrefix}.0/24
            </Text>
          </View>

          {scanProgress ? (
            <Text style={styles.statusText}>{scanProgress}</Text>
          ) : null}

          <Pressable
            style={styles.textAction}
            onPress={() => setScanAdvanced((value) => !value)}
          >
            <Text style={styles.textActionText}>
              {scanAdvanced ? "隐藏高级扫描" : "显示高级扫描"}
            </Text>
          </Pressable>

          {scanAdvanced ? (
            <View style={styles.advancedPane}>
              <TextInput
                style={styles.input}
                value={scanPrefix}
                onChangeText={setScanPrefix}
                autoCapitalize="none"
                placeholder="指定网段，例如 192.168.10"
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
                onPress={() => void runManualScan()}
                disabled={scanLoading}
              >
                <Text style={styles.secondaryButtonText}>
                  扫描 {effectiveScanPrefix}.0/24
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.resultsBlock}>
            <Text style={styles.cardLabel}>搜索结果</Text>
            {knownHosts.length > 0 ? (
              <View style={styles.hostList}>
                {knownHosts.map((host) => {
                  const selected = host.url === selectedHostUrl;
                  return (
                    <Pressable
                      key={host.url}
                      style={[
                        styles.hostItem,
                        selected ? styles.hostItemSelected : null,
                      ]}
                      onPress={() => setSelectedHostUrl(host.url)}
                    >
                      <View style={styles.hostItemMain}>
                        <View
                          style={[
                            styles.hostDot,
                            selected ? styles.hostDotSelected : null,
                          ]}
                        />
                        <Text style={styles.hostName}>{host.label}</Text>
                        <Text style={styles.hostModeBadge}>scan</Text>
                      </View>
                      <View style={styles.hostItemMeta}>
                        <Text style={styles.hostMetaText}>{host.url}</Text>
                        <Text style={styles.hostMetaText}>
                          {host.detail ?? "最近连接"}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.emptyText}>
                还没有扫描结果。先运行自动搜索，或者打开高级扫描。
              </Text>
            )}
          </View>

          <Pressable
            style={styles.secondaryButton}
            onPress={() =>
              navigation.navigate("RecentHosts", {
                currentServerUrl: selectedHostUrl || currentServerUrl,
                recentServers,
              })
            }
          >
            <Text style={styles.secondaryButtonText}>查看历史连接</Text>
          </Pressable>

          <View style={styles.footerActions}>
            <Pressable
              style={[
                styles.secondaryButton,
                !selectedHostUrl.trim() ? styles.primaryButtonDisabled : null,
              ]}
              onPress={() => applySelection(false)}
              disabled={!selectedHostUrl.trim()}
            >
              <Text style={styles.secondaryButtonText}>填入地址</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryButton,
                !selectedHostUrl.trim() ? styles.primaryButtonDisabled : null,
              ]}
              onPress={() => applySelection(true)}
              disabled={!selectedHostUrl.trim()}
            >
              <Text style={styles.primaryButtonText}>直接连接</Text>
            </Pressable>
          </View>
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
      gap: theme.spaceMd,
    },
    headerBlock: {
      gap: theme.spaceXs,
    },
    title: {
      color: theme.text,
      fontSize: 22,
      fontWeight: "800",
    },
    subtitle: {
      color: theme.textSecondary,
      fontSize: 14,
      lineHeight: 21,
    },
    selectedCard: {
      gap: theme.spaceXs,
      padding: theme.spaceMd,
      borderRadius: theme.radiusLg,
      backgroundColor: theme.panelAlt,
      borderWidth: 1,
      borderColor: theme.borderSoft,
    },
    cardLabel: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: "600",
    },
    selectedValue: {
      color: theme.text,
      fontSize: 15,
      fontWeight: "600",
    },
    actionsRow: {
      gap: theme.spaceSm,
    },
    statusText: {
      color: theme.textMuted,
      fontSize: 12,
    },
    textAction: {
      alignItems: "flex-start",
      paddingVertical: theme.spaceXs,
    },
    textActionText: {
      color: theme.textSecondary,
      fontSize: 13,
    },
    advancedPane: {
      gap: theme.spaceSm,
      padding: theme.spaceMd,
      borderRadius: theme.radiusLg,
      backgroundColor: theme.panelAlt,
      borderWidth: 1,
      borderColor: theme.borderSoft,
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
    resultsBlock: {
      gap: theme.spaceSm,
    },
    footerActions: {
      gap: theme.spaceSm,
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
    hostItemSelected: {
      borderColor: theme.brandTeal,
      backgroundColor: theme.panelHover,
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
      backgroundColor: theme.textDimmed,
    },
    hostDotSelected: {
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
      backgroundColor: theme.bg,
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
    },
    primaryButton: {
      minHeight: 48,
      backgroundColor: theme.brandTeal,
      borderRadius: theme.radiusMd,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonDisabled: {
      opacity: 0.5,
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
      alignItems: "center",
    },
    secondaryButtonText: {
      color: theme.text,
      textAlign: "center",
      fontWeight: "700",
      fontSize: 14,
    },
  });
