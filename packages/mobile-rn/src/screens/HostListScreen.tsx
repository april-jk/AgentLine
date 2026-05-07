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
import { ApiClient, type HostItem } from "../lib/api/client";
import { getSecureItem, secureStorageKeys } from "../lib/storage/secureStorage";
import type { RootStackParamList } from "../navigation/types";

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
    <View style={styles.container}>
      <Text style={styles.subtitle}>同账号下在线桌面设备列表</Text>
      {loading ? <ActivityIndicator style={styles.loading} /> : null}
      <FlatList
        data={hosts}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <Text style={styles.empty}>暂无设备，请先在桌面端登录同一账号。</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.item}
            onPress={() =>
              navigation.navigate("Session", {
                hostId: item.id,
                relayUsername: item.relayUsername,
                hostName: item.name,
                mode: item.id === "direct-host" ? "direct" : "relay",
                directServerUrl:
                  item.id === "direct-host"
                    ? item.deviceType.replace("direct · ", "")
                    : undefined,
                directUsername: item.id === "direct-host" ? item.name : undefined,
              })
            }
          >
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.status}>
              {item.status} · {item.relayState} · {item.deviceType}
            </Text>
            <Text style={styles.hint}>relay: {item.relayUsername}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  subtitle: {
    color: "#5B6270",
    marginBottom: 12,
  },
  loading: {
    marginBottom: 12,
  },
  item: {
    borderColor: "#D9DEE8",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
    padding: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
  },
  status: {
    color: "#5B6270",
    marginTop: 4,
  },
  hint: {
    color: "#6F7684",
    fontSize: 12,
    marginTop: 6,
  },
  empty: {
    color: "#5B6270",
    textAlign: "center",
  },
});
