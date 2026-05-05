import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Alert, Button, StyleSheet, Text, TextInput, View } from "react-native";
import { apiClient } from "../lib/api/client";
import { secureStorageKeys, setSecureItem } from "../lib/storage/secureStorage";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onLogin = async () => {
    try {
      setSubmitting(true);
      const result = await apiClient.login({ username, password });
      await setSecureItem(secureStorageKeys.accessToken, result.accessToken);
      navigation.replace("HostList");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      Alert.alert("登录失败", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AgentLine Mobile</Text>
      <TextInput
        autoCapitalize="none"
        placeholder="用户名"
        style={styles.input}
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        secureTextEntry
        placeholder="密码"
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />
      <Button
        title={submitting ? "登录中..." : "登录"}
        onPress={onLogin}
        disabled={submitting}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  input: {
    borderColor: "#C7CCD6",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
