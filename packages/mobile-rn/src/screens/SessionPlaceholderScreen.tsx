import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
  DirectServerClient,
  type DirectProject,
  type DirectServerInfo,
  type DirectSessionDetail,
  type DirectSessionMessage,
  type DirectSessionSummary,
  type SessionPlaceholder,
  toDirectWsUrl,
} from "../lib/api/client";
import {
  type ProbeResult,
  probeDirectHttp,
  probeDirectWebSocket,
  probeRelayRouting,
} from "../lib/connection/probe";
import { getSecureItem, secureStorageKeys } from "../lib/storage/secureStorage";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Session">;

function messageToText(message: DirectSessionMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part.type === "text" && part.text) return part.text;
      return "";
    })
    .join("\n")
    .trim();
}

export function SessionPlaceholderScreen({ route }: Props) {
  const { hostId, relayUsername, hostName, mode, directServerUrl } = route.params;
  const [placeholder, setPlaceholder] = useState<SessionPlaceholder | null>(null);
  const [probeResult, setProbeResult] = useState<ProbeResult>({
    state: "idle",
    message: "等待探测",
  });
  const [httpProbeResult, setHttpProbeResult] = useState<ProbeResult>({
    state: "idle",
    message: "等待探测",
  });
  const [probing, setProbing] = useState(false);
  const [loading, setLoading] = useState(false);

  const [directServerInfo, setDirectServerInfo] = useState<DirectServerInfo | null>(
    null,
  );
  const [directProjects, setDirectProjects] = useState<DirectProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<DirectProject | null>(null);
  const [projectSessions, setProjectSessions] = useState<DirectSessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<DirectSessionSummary | null>(
    null,
  );
  const [sessionDetail, setSessionDetail] = useState<DirectSessionDetail | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);

  const resolvedServerUrl = useMemo(
    () => directServerUrl ?? "",
    [directServerUrl],
  );

  const runProbe = async (serverUrl: string) => {
    setProbing(true);
    try {
      const wsUrl = toDirectWsUrl(serverUrl);
      setHttpProbeResult(await probeDirectHttp(serverUrl));
      setProbeResult(await probeDirectWebSocket(wsUrl));
    } finally {
      setProbing(false);
    }
  };

  const loadDirectOverview = async (serverUrl: string) => {
    setLoading(true);
    try {
      const client = new DirectServerClient(serverUrl);
      const [info, projects] = await Promise.all([
        client.getServerInfo(),
        client.listProjects(),
      ]);
      setDirectServerInfo(info);
      setDirectProjects(projects);
      if (projects.length > 0 && !selectedProject) {
        const firstProject = projects[0];
        if (firstProject) setSelectedProject(firstProject);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadProjectSessions = async (serverUrl: string, projectId: string) => {
    const client = new DirectServerClient(serverUrl);
    const sessions = await client.listProjectSessions(projectId);
    setProjectSessions(sessions);
    if (sessions.length > 0 && !selectedSession) {
      const firstSession = sessions[0];
      if (firstSession) setSelectedSession(firstSession);
    }
  };

  const loadSessionDetail = async (
    serverUrl: string,
    projectId: string,
    sessionId: string,
  ) => {
    const client = new DirectServerClient(serverUrl);
    const detail = await client.getSession(projectId, sessionId);
    setSessionDetail(detail);
  };

  const sendMessageToSession = async () => {
    if (!resolvedServerUrl || !selectedProject || !selectedSession) return;
    const text = messageInput.trim();
    if (!text) return;
    setSending(true);
    try {
      const client = new DirectServerClient(resolvedServerUrl);
      try {
        await client.sendMessage(selectedSession.id, text);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
          message.includes("No active process for session") ||
          message.includes("404")
        ) {
          await client.resumeSession(selectedProject.id, selectedSession.id, text);
        } else {
          throw error;
        }
      }
      setMessageInput("");
      await loadSessionDetail(
        resolvedServerUrl,
        selectedProject.id,
        selectedSession.id,
      );
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (mode === "direct") {
      const bootstrap = async () => {
        const serverUrl =
          resolvedServerUrl ||
          (await getSecureItem(secureStorageKeys.directServerUrl)) ||
          "";
        if (!serverUrl) {
          setHttpProbeResult({
            state: "failed",
            message: "未找到直连服务器地址，请返回登录页重新配置。",
          });
          setProbeResult({
            state: "failed",
            message: "未找到直连服务器地址，请返回登录页重新配置。",
          });
          return;
        }
        setPlaceholder({
          hostId,
          relayUsername: "direct",
          state: "pending",
          message: `已连接 ${serverUrl}，可直接浏览并控制该服务器会话。`,
        });
        await runProbe(serverUrl);
        await loadDirectOverview(serverUrl);
      };
      void bootstrap();
      return;
    }

    const loadRelayPlaceholder = async () => {
      try {
        const controlPlaneUrl =
          (await getSecureItem(secureStorageKeys.controlPlaneUrl)) ??
          "http://10.0.2.2:4400";
        const host = {
          id: hostId,
          name: hostName,
          relayUsername,
          status: "online" as const,
          relayState: "waiting" as const,
          deviceType: "desktop",
        };
        const result = await new ApiClient(controlPlaneUrl).getSessionPlaceholder(host);
        setPlaceholder(result);
      } catch {
        setPlaceholder({
          hostId,
          relayUsername,
          state: "pending",
          message: "Session data failed to load.",
        });
      }
    };
    void loadRelayPlaceholder();
  }, [hostId, hostName, mode, relayUsername, resolvedServerUrl]);

  useEffect(() => {
    if (!resolvedServerUrl || !selectedProject) return;
    void loadProjectSessions(resolvedServerUrl, selectedProject.id);
    setSelectedSession(null);
    setSessionDetail(null);
  }, [resolvedServerUrl, selectedProject]);

  useEffect(() => {
    if (!resolvedServerUrl || !selectedProject || !selectedSession) return;
    void loadSessionDetail(resolvedServerUrl, selectedProject.id, selectedSession.id);
  }, [resolvedServerUrl, selectedProject, selectedSession]);

  useEffect(() => {
    if (!resolvedServerUrl || !selectedProject || !selectedSession) return;
    const timer = setInterval(() => {
      void loadSessionDetail(resolvedServerUrl, selectedProject.id, selectedSession.id);
    }, 3000);
    return () => clearInterval(timer);
  }, [resolvedServerUrl, selectedProject, selectedSession]);

  if (!placeholder) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (mode !== "direct") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Host: {hostName}</Text>
        <Text style={styles.message}>{placeholder.message}</Text>
        <Text style={styles.probe}>
          中继探测：{probeResult.state} · {probeResult.message}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>内网直连控制台</Text>
      <Text style={styles.sub}>Host: {hostName}</Text>
      <Text style={styles.probe}>
        HTTP: {httpProbeResult.state} · WS: {probeResult.state}
      </Text>
      <Text style={styles.sub}>
        绑定：{directServerInfo?.host ?? "-"}:{directServerInfo?.port ?? "-"}
      </Text>
      <Button
        title={probing || loading ? "刷新中..." : "刷新服务器数据"}
        onPress={() => {
          if (resolvedServerUrl) {
            void runProbe(resolvedServerUrl);
            void loadDirectOverview(resolvedServerUrl);
          }
        }}
        disabled={probing || loading}
      />

      <Text style={styles.section}>项目</Text>
      <FlatList
        horizontal
        data={directProjects}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.chip,
              selectedProject?.id === item.id ? styles.chipActive : null,
            ]}
            onPress={() => setSelectedProject(item)}
          >
            <Text style={styles.chipText}>{item.name}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>暂无项目</Text>}
      />

      <Text style={styles.section}>会话</Text>
      <FlatList
        horizontal
        data={projectSessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.chip,
              selectedSession?.id === item.id ? styles.chipActive : null,
            ]}
            onPress={() => setSelectedSession(item)}
          >
            <Text style={styles.chipText}>{item.title ?? item.id.slice(0, 8)}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>暂无会话</Text>}
      />

      <Text style={styles.section}>消息</Text>
      <FlatList
        style={styles.messageList}
        data={sessionDetail?.messages ?? sessionDetail?.session.messages ?? []}
        keyExtractor={(item, index) => item.id ?? `${index}`}
        renderItem={({ item }) => (
          <View style={styles.msgItem}>
            <Text style={styles.msgRole}>{item.role ?? item.type ?? "unknown"}</Text>
            <Text style={styles.msgText}>{messageToText(item)}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>暂无消息</Text>}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="输入消息控制该会话"
          value={messageInput}
          onChangeText={setMessageInput}
        />
        <Button
          title={sending ? "发送中..." : "发送"}
          onPress={() => void sendMessageToSession()}
          disabled={sending || !selectedProject || !selectedSession}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 8,
    padding: 12,
  },
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  sub: {
    color: "#5B6270",
  },
  message: {
    color: "#5B6270",
    marginTop: 8,
    textAlign: "center",
  },
  probe: {
    color: "#2B3D67",
  },
  section: {
    color: "#1F2A44",
    fontWeight: "700",
    marginTop: 6,
  },
  chip: {
    backgroundColor: "#F4F6FA",
    borderColor: "#D9DEE8",
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: "#E7ECF8",
    borderColor: "#7F8FB6",
  },
  chipText: {
    color: "#1E2430",
    fontSize: 12,
  },
  empty: {
    color: "#7A8190",
    paddingVertical: 8,
  },
  messageList: {
    borderColor: "#D9DEE8",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    padding: 8,
  },
  msgItem: {
    marginBottom: 8,
  },
  msgRole: {
    color: "#3F4A61",
    fontSize: 11,
    fontWeight: "700",
  },
  msgText: {
    color: "#1F2430",
    fontSize: 13,
    marginTop: 2,
  },
  inputRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  input: {
    borderColor: "#C7CCD6",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
