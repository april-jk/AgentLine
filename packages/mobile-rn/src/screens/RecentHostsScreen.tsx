import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DirectServerClient, isDirectServerInfo } from "../lib/api/client";
import type { RootStackParamList } from "../navigation/types";
import { useThemePreference } from "../styles/ThemePreferenceContext";
import type { AppTheme } from "../styles/theme";
import { useAppTheme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "RecentHosts">;

type ProbeStatus = "idle" | "checking" | "online" | "offline";
type ProbeInfo = {
  status: ProbeStatus;
  installId?: string;
  hostAccessUsername?: string;
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

function dedupeRecentHosts(recentServers: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const url of recentServers) {
    if (!url.trim() || seen.has(url)) continue;
    seen.add(url);
    deduped.push(url);
  }

  return deduped;
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

async function probeHost(url: string): Promise<ProbeInfo> {
  try {
    const client = new DirectServerClient(url);
    const health = await withTimeout(client.getHealth(), 1400);
    if (health.status !== "ok") return { status: "offline" };
    const info = await withTimeout(client.getServerInfo(), 1600);
    if (!isDirectServerInfo(info)) return { status: "offline" };
    return {
      status: "online",
      installId: info.installId,
      hostAccessUsername: info.hostAccess?.username,
    };
  } catch {
    return { status: "offline" };
  }
}

export function RecentHostsScreen({ navigation, route }: Props) {
  const { themeMode } = useThemePreference();
  const theme = useAppTheme(themeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { currentServerUrl, recentServers } = route.params;

  const hosts = useMemo(
    () => dedupeRecentHosts(recentServers),
    [recentServers],
  );
  const [selectedHostUrl, setSelectedHostUrl] = useState(currentServerUrl);
  const [isChecking, setIsChecking] = useState(false);
  const [probeInfoMap, setProbeInfoMap] = useState<Record<string, ProbeInfo>>(
    {},
  );

  useEffect(() => {
    if (!selectedHostUrl && hosts[0]) {
      setSelectedHostUrl(hosts[0]);
    }
  }, [hosts, selectedHostUrl]);

  const runProbe = useCallback(async () => {
    if (hosts.length <= 0) return;

    setIsChecking(true);
    setProbeInfoMap((prev) => {
      const next = { ...prev };
      for (const host of hosts) next[host] = { status: "checking" };
      return next;
    });

    const updates = await Promise.all(
      hosts.map(async (host) => ({
        host,
        info: await probeHost(host),
      })),
    );

    setProbeInfoMap((prev) => {
      const next = { ...prev };
      for (const item of updates) {
        next[item.host] = item.info;
      }
      return next;
    });
    setIsChecking(false);
  }, [hosts]);

  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  const applySelection = (connectOnSelect: boolean) => {
    if (!selectedHostUrl.trim()) return;
    const selectedProbe = probeInfoMap[selectedHostUrl];
    navigation.popTo("Login", {
      mode: "direct",
      selectedHostUrl,
      selectedHostInstallId: selectedProbe?.installId,
      selectedHostAccessUsername: selectedProbe?.hostAccessUsername,
      connectOnSelect,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.surface}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>历史连接主机</Text>
            <Pressable
              style={styles.ghostButton}
              onPress={() => void runProbe()}
              disabled={isChecking}
            >
              {isChecking ? (
                <ActivityIndicator color={theme.brandTeal} />
              ) : (
                <Text style={styles.ghostButtonText}>刷新在线状态</Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            状态点：透明=未连接/不可达，黄色=检测中，绿色=在线可连接。
          </Text>

          {hosts.length > 0 ? (
            <View style={styles.hostList}>
              {hosts.map((host) => {
                const selected = host === selectedHostUrl;
                const status = probeInfoMap[host]?.status ?? "idle";
                return (
                  <Pressable
                    key={host}
                    style={[
                      styles.hostItem,
                      selected ? styles.hostItemSelected : null,
                    ]}
                    onPress={() => setSelectedHostUrl(host)}
                  >
                    <View style={styles.hostItemMain}>
                      <View
                        style={[
                          styles.hostDot,
                          status === "checking" ? styles.hostDotChecking : null,
                          status === "online" ? styles.hostDotOnline : null,
                        ]}
                      />
                      <Text style={styles.hostName}>
                        {normalizeLabelFromUrl(host)}
                      </Text>
                    </View>
                    <Text style={styles.hostMetaText}>{host}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyText}>还没有历史连接记录。</Text>
          )}

          <View style={styles.footerActions}>
            <Pressable
              style={[
                styles.secondaryButton,
                !selectedHostUrl.trim() ? styles.disabledButton : null,
              ]}
              onPress={() => applySelection(false)}
              disabled={!selectedHostUrl.trim()}
            >
              <Text style={styles.secondaryButtonText}>填入地址</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryButton,
                !selectedHostUrl.trim() ? styles.disabledButton : null,
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
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spaceMd,
    },
    title: {
      color: theme.text,
      fontSize: 20,
      fontWeight: "800",
    },
    subtitle: {
      color: theme.textSecondary,
      fontSize: 13,
      lineHeight: 20,
    },
    ghostButton: {
      minHeight: 36,
      paddingHorizontal: 10,
      borderRadius: theme.radiusMd,
      borderWidth: 1,
      borderColor: theme.borderSoft,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.panelAlt,
    },
    ghostButtonText: {
      color: theme.textSecondary,
      fontSize: 12,
      fontWeight: "600",
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
      width: 9,
      height: 9,
      borderRadius: 999,
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: theme.borderSoft,
    },
    hostDotChecking: {
      backgroundColor: "#f4d35e",
      borderColor: "#f4d35e",
    },
    hostDotOnline: {
      backgroundColor: theme.success,
      borderColor: theme.success,
    },
    hostName: {
      color: theme.text,
      fontSize: 14,
      fontWeight: "600",
      flex: 1,
    },
    hostMetaText: {
      color: theme.textMuted,
      fontSize: 11,
      paddingLeft: 18,
    },
    emptyText: {
      color: theme.textSecondary,
      fontSize: 14,
      lineHeight: 21,
    },
    footerActions: {
      gap: theme.spaceSm,
      marginTop: theme.spaceSm,
    },
    primaryButton: {
      minHeight: 48,
      backgroundColor: theme.brandTeal,
      borderRadius: theme.radiusMd,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButton: {
      backgroundColor: theme.input,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: theme.radiusMd,
      paddingVertical: 12,
      alignItems: "center",
    },
    disabledButton: {
      opacity: 0.5,
    },
    primaryButtonText: {
      color: "#f3fbf8",
      textAlign: "center",
      fontWeight: "800",
      fontSize: 15,
    },
    secondaryButtonText: {
      color: theme.text,
      textAlign: "center",
      fontWeight: "700",
      fontSize: 14,
    },
  });
