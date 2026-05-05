import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { type HostItem, apiClient } from "../lib/api/client";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "HostList">;

export function HostListScreen({ navigation }: Props) {
  const [hosts, setHosts] = useState<HostItem[]>([]);

  useEffect(() => {
    apiClient
      .listHosts()
      .then(setHosts)
      .catch(() => setHosts([]));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.subtitle}>点击主机进入会话占位页</Text>
      <FlatList
        data={hosts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.item}
            onPress={() => navigation.navigate("Session", { hostId: item.id })}
          >
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.status}>{item.status}</Text>
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
});
