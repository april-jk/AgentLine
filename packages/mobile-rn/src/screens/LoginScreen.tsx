import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { theme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

function AppButton({
  title,
  onPress,
  disabled,
  variant = "primary",
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        variant === "primary" ? styles.buttonPrimary : styles.buttonGhost,
        pressed && !disabled ? styles.buttonPressed : null,
        disabled ? styles.buttonDisabled : null,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={variant === "primary" ? styles.buttonText : styles.buttonGhostText}>
        {title}
      </Text>
    </Pressable>
  );
}

export function LoginScreen({ navigation }: Props) {
  const [mode, setMode] = useState<ConnectionMode>("direct");
  const [controlPlaneUrl, setControlPlaneUrl] = useState("http://10.0.2.2:4400");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [directServerUrl, setDirectServerUrl] = useState("http://10.0.2.2:45731");
  const [directUsername, setDirectUsername] = useState("");
  const [directPassword, setDirectPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scanPrefix, setScanPrefix] = useState("192.168.1");
  const [scanPort, setScanPort] = useState("45731");
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
    const port = Number(scanPort.trim() || "45731");
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
    const port = Number(scanPort.trim() || "45731");
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
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>AgentLine Mobile</Text>
        <Text style={styles.subtitle}>Mobile Supervision Panel</Text>

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
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>直连配置</Text>
            <TextInput
              autoCapitalize="none"
              placeholder="服务器地址（http://电脑IP:45731）"
              placeholderTextColor={theme.textMuted}
              style={styles.input}
              value={directServerUrl}
              onChangeText={setDirectServerUrl}
            />
            <TextInput
              autoCapitalize="none"
              placeholder="显示名称（可选）"
              placeholderTextColor={theme.textMuted}
              style={styles.input}
              value={directUsername}
              onChangeText={setDirectUsername}
            />
            <TextInput
              secureTextEntry
              placeholder="密码（可选）"
              placeholderTextColor={theme.textMuted}
              style={styles.input}
              value={directPassword}
              onChangeText={setDirectPassword}
            />
            <AppButton
              title={submitting ? "配置中..." : "保存并连接"}
              onPress={onDirectConnect}
              disabled={submitting}
            />

            <View style={styles.scanPanel}>
              <Text style={styles.sectionTitle}>一键找电脑</Text>
              <TextInput
                autoCapitalize="none"
                keyboardType="numeric"
                placeholder="端口（默认 45731）"
                placeholderTextColor={theme.textMuted}
                style={styles.input}
                value={scanPort}
                onChangeText={setScanPort}
              />
              <AppButton
                title={scanLoading ? "扫描中..." : "智能扫描并连接"}
                onPress={onSmartScanLan}
                disabled={scanLoading}
              />
              {scanProgress ? <Text style={styles.progressText}>{scanProgress}</Text> : null}
              <AppButton
                title={scanAdvanced ? "收起高级选项" : "高级选项（手动网段）"}
                onPress={() => setScanAdvanced((value) => !value)}
                variant="ghost"
              />

              {scanAdvanced ? (
                <>
                  <TextInput
                    autoCapitalize="none"
                    placeholder="网段前缀，如 192.168.1"
                    placeholderTextColor={theme.textMuted}
                    style={styles.input}
                    value={scanPrefix}
                    onChangeText={setScanPrefix}
                  />
                  <AppButton
                    title={scanLoading ? "扫描中..." : "按网段扫描"}
                    onPress={onScanLan}
                    disabled={scanLoading}
                    variant="ghost"
                  />
                </>
              ) : null}

              <FlatList
                style={styles.scanList}
                data={scanResults}
                keyExtractor={(item) => item.baseUrl}
                scrollEnabled={false}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>
                    {scanLoading ? "正在扫描..." : "扫描结果会出现在这里"}
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
                      host={item.host} · deviceBridge={item.deviceBridge ? "on" : "off"}
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
                    showsHorizontalScrollIndicator={false}
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
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>中继登录</Text>
            <TextInput
              autoCapitalize="none"
              placeholder="控制平面地址（http://host:4400）"
              placeholderTextColor={theme.textMuted}
              style={styles.input}
              value={controlPlaneUrl}
              onChangeText={setControlPlaneUrl}
            />
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="邮箱"
              placeholderTextColor={theme.textMuted}
              style={styles.input}
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              secureTextEntry
              placeholder="密码"
              placeholderTextColor={theme.textMuted}
              style={styles.input}
              value={password}
              onChangeText={setPassword}
            />
            <AppButton
              title={submitting ? "登录中..." : "登录并拉取设备"}
              onPress={onRelayLogin}
              disabled={submitting}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: theme.bg,
    flex: 1,
  },
  container: {
    gap: theme.spaceMd,
    padding: theme.spaceLg,
    paddingBottom: theme.spaceLg * 2,
  },
  title: {
    color: theme.text,
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: theme.textSecondary,
    fontSize: 13,
    marginTop: -6,
    textAlign: "center",
  },
  modeRow: {
    flexDirection: "row",
    gap: theme.spaceSm,
  },
  modeButton: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  modeActive: {
    backgroundColor: theme.panelAlt,
    borderColor: theme.primary,
  },
  modeText: {
    color: theme.text,
    fontWeight: "600",
    textAlign: "center",
  },
  card: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    gap: theme.spaceSm,
    padding: theme.spaceMd,
  },
  sectionTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  input: {
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  button: {
    borderRadius: theme.radiusSm,
    paddingVertical: 12,
  },
  buttonPrimary: {
    backgroundColor: theme.primary,
  },
  buttonGhost: {
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#0a1725",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  buttonGhostText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  scanPanel: {
    backgroundColor: theme.bg,
    borderColor: theme.borderSoft,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    gap: theme.spaceSm,
    marginTop: theme.spaceXs,
    padding: theme.spaceSm,
  },
  progressText: {
    color: theme.warning,
    fontSize: 12,
    textAlign: "center",
  },
  scanList: {
    marginTop: 2,
  },
  emptyText: {
    color: theme.textMuted,
    textAlign: "center",
  },
  scanItem: {
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    marginBottom: 8,
    padding: 10,
  },
  scanItemTitle: {
    color: theme.text,
    fontWeight: "600",
  },
  scanItemSub: {
    color: theme.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  recentTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  recentChip: {
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  recentChipText: {
    color: theme.textSecondary,
    fontSize: 12,
  },
});
