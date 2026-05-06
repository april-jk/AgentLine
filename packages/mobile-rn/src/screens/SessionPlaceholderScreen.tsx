import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { type SessionPlaceholder, apiClient } from "../lib/api/client";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Session">;

export function SessionPlaceholderScreen({ route }: Props) {
  const { hostId, relayUsername, hostName } = route.params;
  const [placeholder, setPlaceholder] = useState<SessionPlaceholder | null>(
    null,
  );

  useEffect(() => {
    const host = {
      id: hostId,
      name: hostName,
      relayUsername,
      status: "online" as const,
      relayState: "waiting" as const,
      deviceType: "desktop",
    };
    apiClient
      .getSessionPlaceholder(host)
      .then(setPlaceholder)
      .catch(() => {
        setPlaceholder({
          hostId,
          relayUsername,
          state: "pending",
          message: "Session data failed to load.",
        });
      });
  }, [hostId, hostName, relayUsername]);

  return (
    <View style={styles.container}>
      {placeholder ? (
        <>
          <Text style={styles.title}>Host: {hostName}</Text>
          <Text style={styles.sub}>DeviceId: {placeholder.hostId}</Text>
          <Text style={styles.sub}>Relay: {placeholder.relayUsername}</Text>
          <Text style={styles.message}>{placeholder.message}</Text>
        </>
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  sub: {
    color: "#6A7080",
    marginBottom: 4,
  },
  message: {
    color: "#5B6270",
    marginTop: 8,
    textAlign: "center",
  },
});
