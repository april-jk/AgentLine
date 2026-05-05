import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { type SessionPlaceholder, apiClient } from "../lib/api/client";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Session">;

export function SessionPlaceholderScreen({ route }: Props) {
  const { hostId } = route.params;
  const [placeholder, setPlaceholder] = useState<SessionPlaceholder | null>(
    null,
  );

  useEffect(() => {
    apiClient
      .getSessionPlaceholder(hostId)
      .then(setPlaceholder)
      .catch(() => {
        setPlaceholder({
          hostId,
          state: "pending",
          message: "Session data failed to load.",
        });
      });
  }, [hostId]);

  return (
    <View style={styles.container}>
      {placeholder ? (
        <>
          <Text style={styles.title}>Host: {placeholder.hostId}</Text>
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
  message: {
    color: "#5B6270",
    textAlign: "center",
  },
});
