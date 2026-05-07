import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiClient, type HostItem } from "../lib/api/client";
import { getSecureItem, secureStorageKeys } from "../lib/storage/secureStorage";
import type { RootStackParamList } from "../navigation/types";
import { theme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "HostList">;

export function HostListScreen({ navigation }: Props) {
  const [hosts, setHosts] = useState<HostItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadHosts = async () => {
      try {
        const mode = await getSecureItem(secureStorageKeys.connectionMode);
        if (mode === "direct") {
          const serverUrl = await getSecureItem(secureStorageKeys.directServerUrl);
          const username = await getSecureItem(secureStorageKeys.directUsername);
          if (!serverUrl) {
            navigation.replace("Login");
            return;
          }
          const directHost: HostItem = {
            id: "direct-host",
            name: username?.trim() ? username : serverUrl.replace(/^https?:\/\//, ""),
            status: "online",
            relayState: "offline",
            relayUsername: "direct",
            deviceType: `direct · ${serverUrl}`,
          };
          if (!cancelled) {
            setHosts([directHost]);
          }
          return;
        }
        const accessToken = await getSecureItem(secureStorageKeys.accessToken);
        const controlPlaneUrl =
          (await getSecureItem(secureStorageKeys.controlPlaneUrl)) ??
          "http://10.0.2.2:4400";
        if (!accessToken) {
          navigation.replace("Login");
          return;
        }
        const result = await new ApiClient(controlPlaneUrl).listHosts(accessToken);
        if (!cancelled) {
          setHosts(result);
        }
      } catch {
        if (!cancelled) {
          setHosts([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadHosts();

    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>设备列表</Text>
        <Text style={styles.subtitle}>同账号下在线桌面设备</Text>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.primary} />
            <Text style={styles.loadingText}>正在加载设备...</Text>
          </View>
        ) : null}

        <FlatList
          data={hosts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>暂无设备</Text>
              <Text style={styles.emptySub}>请先在桌面端启动 AgentLine 并完成登录</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isDirect = item.id === "direct-host";
            return (
              <Pressable
                style={({ pressed }) => [styles.item, pressed ? styles.itemPressed : null]}
                onPress={() =>
                  navigation.navigate("Session", {
                    hostId: item.id,
                    relayUsername: item.relayUsername,
                    hostName: item.name,
                    mode: isDirect ? "direct" : "relay",
                    directServerUrl: isDirect
                      ? item.deviceType.replace("direct · ", "")
                      : undefined,
                    directUsername: isDirect ? item.name : undefined,
                  })
                }
              >
                <View style={styles.itemTop}>
                  <Text style={styles.name}>{item.name}</Text>
                  <View style={[styles.badge, isDirect ? styles.badgeDirect : styles.badgeRelay]}>
                    <Text style={styles.badgeText}>{isDirect ? "直连" : "中继"}</Text>
                  </View>
                </View>
                <Text style={styles.statusLine}>
                  {item.status} · {item.relayState}
                </Text>
                <Text style={styles.detail} numberOfLines={1}>
                  {item.deviceType}
                </Text>
                <Text style={styles.hint}>relay: {item.relayUsername}</Text>
              </Pressable>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: theme.bg,
    flex: 1,
  },
  container: {
    flex: 1,
    padding: theme.spaceLg,
  },
  title: {
    color: theme.text,
    fontSize: 24,
    fontWeight: "700",
  },
  subtitle: {
    color: theme.textSecondary,
    marginBottom: theme.spaceMd,
    marginTop: 4,
  },
  loadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: theme.spaceSm,
  },
  loadingText: {
    color: theme.textSecondary,
  },
  listContent: {
    gap: theme.spaceSm,
    paddingBottom: theme.spaceLg,
  },
  item: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    padding: theme.spaceMd,
  },
  itemPressed: {
    opacity: 0.86,
  },
  itemTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  name: {
    color: theme.text,
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    marginRight: 12,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeDirect: {
    backgroundColor: "#1f3b30",
  },
  badgeRelay: {
    backgroundColor: "#2e3241",
  },
  badgeText: {
    color: theme.text,
    fontSize: 11,
    fontWeight: "700",
  },
  statusLine: {
    color: theme.success,
    fontWeight: "600",
  },
  detail: {
    color: theme.textSecondary,
    marginTop: 4,
  },
  hint: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    marginTop: 8,
    padding: theme.spaceLg,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  emptySub: {
    color: theme.textSecondary,
    textAlign: "center",
  },
});
