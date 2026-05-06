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
import { type HostItem, apiClient } from "../lib/api/client";
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
        const accessToken = await getSecureItem(secureStorageKeys.accessToken);
        if (!accessToken) {
          navigation.replace("Login");
          return;
        }
        const result = await apiClient.listHosts(accessToken);
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
