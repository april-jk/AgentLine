import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ApiClient,
  type ConnectionMode,
  normalizeHttpBaseUrl,
} from "../lib/api/client";
import {
  type LanScanResult,
  scanLanServers,
  smartScanLanServers,
} from "../lib/connection/lanScanner";
import {
  getSecureItem,
  secureStorageKeys,
  setSecureItem,
} from "../lib/storage/secureStorage";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const [mode, setMode] = useState<ConnectionMode>("direct");
  const [controlPlaneUrl, setControlPlaneUrl] = useState("http://10.0.2.2:4400");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [directServerUrl, setDirectServerUrl] = useState("http://10.0.2.2:3400");
  const [directUsername, setDirectUsername] = useState("");
  const [directPassword, setDirectPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scanPrefix, setScanPrefix] = useState("192.168.1");
  const [scanPort, setScanPort] = useState("3400");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<LanScanResult[]>([]);
  const [scanProgress, setScanProgress] = useState("");
  const [scanAdvanced, setScanAdvanced] = useState(false);
  const [recentServers, setRecentServers] = useState<string[]>([]);

  useEffect(() => {
    const loadRecentServers = async () => {
      const raw = await getSecureItem(secureStorageKeys.recentDirectServers);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const urls = parsed
            .filter((item): item is string => typeof item === "string")
            .slice(0, 10);
          setRecentServers(urls);
        }
      } catch {
        // ignore invalid persisted JSON
      }
    };
    void loadRecentServers();
  }, []);

  const persistRecentServer = async (serverUrl: string) => {
    const normalized = normalizeHttpBaseUrl(serverUrl);
    const merged = [normalized, ...recentServers.filter((x) => x !== normalized)].slice(
      0,
      10,
    );
    setRecentServers(merged);
    await setSecureItem(secureStorageKeys.recentDirectServers, JSON.stringify(merged));
  };

  const connectToDirectServer = async (serverUrl: string, username?: string) => {
    const normalizedHttpUrl = normalizeHttpBaseUrl(serverUrl);
    const autoUsername = username?.trim()
      ? username.trim()
      : normalizedHttpUrl.replace(/^https?:\/\//, "");
    await setSecureItem(secureStorageKeys.directServerUrl, normalizedHttpUrl);
    await setSecureItem(secureStorageKeys.directUsername, autoUsername);
    await setSecureItem(secureStorageKeys.directPassword, directPassword.trim());
    await setSecureItem(secureStorageKeys.connectionMode, "direct");
    await persistRecentServer(normalizedHttpUrl);
    setDirectServerUrl(normalizedHttpUrl);
    setDirectUsername(autoUsername);
    navigation.replace("HostList");
  };

  const onRelayLogin = async () => {
    try {
      if (!email.trim() || !password) {
        Alert.alert("登录失败", "请输入中继账号邮箱和密码");
        return;
      }
      setSubmitting(true);
      const client = new ApiClient(controlPlaneUrl.trim());
      const result = await client.login({ email: email.trim(), password });
      await setSecureItem(secureStorageKeys.accessToken, result.accessToken);
      await setSecureItem(secureStorageKeys.controlPlaneUrl, controlPlaneUrl.trim());
      await setSecureItem(secureStorageKeys.connectionMode, "relay");
      navigation.replace("HostList");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      Alert.alert("登录失败", message);
    } finally {
      setSubmitting(false);
    }
  };

  const onDirectConnect = async () => {
    try {
      if (!directServerUrl.trim()) {
        Alert.alert("配置失败", "请填写直连地址");
        return;
      }
      setSubmitting(true);
      await connectToDirectServer(directServerUrl, directUsername);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      Alert.alert("配置失败", message);
    } finally {
      setSubmitting(false);
    }
  };

  const onSmartScanLan = async () => {
    const port = Number(scanPort.trim() || "3400");
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      Alert.alert("扫描失败", "端口必须是 1-65535");
      return;
    }
    try {
      setScanLoading(true);
      setScanProgress("正在智能扫描...");
      setScanResults([]);
      const found = await smartScanLanServers({
        port,
        recentServers,
        onProgress: (progress) => {
          setScanProgress(
            progress.phase === "quick"
              ? `快速扫描 ${progress.scanned}/${progress.total}`
              : `扩展扫描 ${progress.scanned}/${progress.total}`,
          );
        },
      });
      setScanResults(found);
      if (found.length === 1) {
        const only = found[0];
        if (only) {
          await connectToDirectServer(only.baseUrl, only.baseUrl);
        }
        return;
      }
      if (found.length === 0) {
        Alert.alert(
          "未发现电脑",
          "请确保电脑和手机在同一 Wi-Fi，且电脑端 AgentLine 正在运行。",
        );
      }
    } catch {
      Alert.alert("扫描失败", "智能扫描中断，请重试。");
    } finally {
      setScanLoading(false);
      setScanProgress("");
    }
  };

  const onScanLan = async () => {
    const prefix = scanPrefix.trim();
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(prefix)) {
      Alert.alert("扫描失败", "网段前缀格式应为 192.168.1");
      return;
    }
    const port = Number(scanPort.trim() || "3400");
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      Alert.alert("扫描失败", "端口必须是 1-65535");
      return;
    }
    try {
      setScanLoading(true);
      setScanProgress("正在手动网段扫描...");
      setScanResults([]);
      const found = await scanLanServers(prefix, port);
      setScanResults(found);
      if (found.length === 0) {
        Alert.alert("扫描完成", "未发现可连接的 AgentLine 服务器。");
      }
    } catch {
      Alert.alert("扫描失败", "内网扫描中断，请重试。");
    } finally {
      setScanLoading(false);
      setScanProgress("");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AgentLine Mobile</Text>
      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeButton, mode === "direct" ? styles.modeActive : null]}
          onPress={() => setMode("direct")}
        >
          <Text style={styles.modeText}>直连服务器</Text>
        </Pressable>
        <Pressable
          style={[styles.modeButton, mode === "relay" ? styles.modeActive : null]}
          onPress={() => setMode("relay")}
        >
          <Text style={styles.modeText}>中继账号</Text>
        </Pressable>
      </View>

      {mode === "direct" ? (
        <>
          <TextInput
            autoCapitalize="none"
            placeholder="服务器地址（http://电脑IP:3400）"
            style={styles.input}
            value={directServerUrl}
            onChangeText={setDirectServerUrl}
          />
          <TextInput
            autoCapitalize="none"
            placeholder="用户名"
            style={styles.input}
            value={directUsername}
            onChangeText={setDirectUsername}
          />
          <TextInput
            secureTextEntry
            placeholder="密码"
            style={styles.input}
            value={directPassword}
            onChangeText={setDirectPassword}
          />
          <Button
            title={submitting ? "配置中..." : "保存并连接"}
            onPress={onDirectConnect}
            disabled={submitting}
          />
          <View style={styles.scanPanel}>
            <Text style={styles.scanTitle}>一键找电脑</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="numeric"
              placeholder="端口（默认 3400，不懂可不改）"
              style={styles.input}
              value={scanPort}
              onChangeText={setScanPort}
            />
            <Button
              title={scanLoading ? "扫描中..." : "智能扫描并连接"}
              onPress={onSmartScanLan}
              disabled={scanLoading}
            />
            {scanProgress ? <Text style={styles.scanProgress}>{scanProgress}</Text> : null}
            <Pressable
              onPress={() => setScanAdvanced((value) => !value)}
              style={styles.advancedToggle}
            >
              <Text style={styles.advancedText}>
                {scanAdvanced ? "收起高级选项" : "高级选项（手动网段）"}
              </Text>
            </Pressable>
            {scanAdvanced ? (
              <>
                <TextInput
                  autoCapitalize="none"
                  placeholder="网段前缀，如 192.168.1"
                  style={styles.input}
                  value={scanPrefix}
                  onChangeText={setScanPrefix}
                />
                <Button
                  title={scanLoading ? "扫描中..." : "按网段扫描"}
                  onPress={onScanLan}
                  disabled={scanLoading}
                />
              </>
            ) : null}
            <FlatList
              style={styles.scanList}
              data={scanResults}
              keyExtractor={(item) => item.baseUrl}
              ListEmptyComponent={
                <Text style={styles.scanEmpty}>
                  {scanLoading
                    ? "正在扫描..."
                    : "扫描结果会出现在这里，点击即可连接"}
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={styles.scanItem}
                  onPress={async () => {
                    try {
                      await connectToDirectServer(item.baseUrl, item.baseUrl);
                    } catch {
                      Alert.alert("连接失败", "写入直连配置失败，请重试。");
                    }
                  }}
                >
                  <Text style={styles.scanItemTitle}>{item.baseUrl}</Text>
                  <Text style={styles.scanItemSub}>
                    host={item.host} · deviceBridge=
                    {item.deviceBridge ? "on" : "off"}
                  </Text>
                </Pressable>
              )}
            />
            {recentServers.length > 0 ? (
              <>
                <Text style={styles.recentTitle}>最近连接</Text>
                <FlatList
                  horizontal
                  data={recentServers}
                  keyExtractor={(item) => item}
                  renderItem={({ item }) => (
                    <Pressable
                      style={styles.recentChip}
                      onPress={async () => {
                        try {
                          await connectToDirectServer(item, item);
                        } catch {
                          Alert.alert("连接失败", "连接最近服务器失败。");
                        }
                      }}
                    >
                      <Text style={styles.recentChipText}>
                        {item.replace(/^https?:\/\//, "")}
                      </Text>
                    </Pressable>
                  )}
                />
              </>
            ) : null}
          </View>
        </>
      ) : (
        <>
          <TextInput
            autoCapitalize="none"
            placeholder="控制平面地址（http://host:4400）"
            style={styles.input}
            value={controlPlaneUrl}
            onChangeText={setControlPlaneUrl}
          />
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="邮箱"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            secureTextEntry
            placeholder="密码"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
          />
          <Button
            title={submitting ? "登录中..." : "登录并拉取设备"}
            onPress={onRelayLogin}
            disabled={submitting}
          />
        </>
      )}
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
  modeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modeButton: {
    borderColor: "#C7CCD6",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 10,
  },
  modeActive: {
    backgroundColor: "#E7ECF8",
    borderColor: "#7F8FB6",
  },
  modeText: {
    fontWeight: "600",
    textAlign: "center",
  },
  input: {
    borderColor: "#C7CCD6",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scanPanel: {
    borderColor: "#D9DEE8",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 6,
    maxHeight: 280,
    padding: 10,
  },
  scanTitle: {
    color: "#1F2A44",
    fontWeight: "700",
    marginBottom: 8,
  },
  scanList: {
    marginTop: 8,
  },
  scanProgress: {
    color: "#4B556A",
    marginTop: 8,
    textAlign: "center",
  },
  advancedToggle: {
    marginTop: 8,
  },
  advancedText: {
    color: "#3E5C99",
    textAlign: "center",
  },
  scanEmpty: {
    color: "#6F7684",
    textAlign: "center",
  },
  scanItem: {
    borderColor: "#D9DEE8",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    padding: 8,
  },
  scanItemTitle: {
    color: "#202533",
    fontWeight: "600",
  },
  scanItemSub: {
    color: "#6B7280",
    fontSize: 12,
    marginTop: 4,
  },
  recentTitle: {
    color: "#1F2A44",
    fontWeight: "700",
    marginTop: 6,
  },
  recentChip: {
    backgroundColor: "#F3F6FC",
    borderColor: "#D2D9E8",
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recentChipText: {
    color: "#2F3D56",
    fontSize: 12,
  },
});
