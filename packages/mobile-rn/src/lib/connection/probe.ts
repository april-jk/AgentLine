export type ProbeState =
  | "idle"
  | "connecting"
  | "connected"
  | "failed"
  | "unsupported";

export type ProbeResult = {
  state: ProbeState;
  message: string;
};

function toRelayWsUrl(rawRelayUrl: string): string {
  const value = rawRelayUrl.trim();
  if (value.startsWith("ws://") || value.startsWith("wss://")) {
    return value;
  }
  if (value.startsWith("http://")) {
    return value.replace("http://", "ws://");
  }
  if (value.startsWith("https://")) {
    return value.replace("https://", "wss://");
  }
  return `wss://${value}`;
}

export function probeDirectWebSocket(
  wsUrl: string,
  timeoutMs = 8000,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let done = false;
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      socket.close();
      resolve({
        state: "failed",
        message: `直连超时（${timeoutMs}ms）：${wsUrl}`,
      });
    }, timeoutMs);

    socket.onopen = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve({
        state: "connected",
        message: `直连成功：${wsUrl}`,
      });
    };

    socket.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        state: "failed",
        message: `直连失败：${wsUrl}`,
      });
    };
  });
}

export async function probeDirectHttp(
  serverBaseUrl: string,
  timeoutMs = 8000,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${serverBaseUrl.replace(/\/+$/, "")}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        state: "failed",
        message: `HTTP 连通失败 (${response.status})：${serverBaseUrl}`,
      };
    }
    return {
      state: "connected",
      message: `HTTP 连通成功：${serverBaseUrl}`,
    };
  } catch {
    return {
      state: "failed",
      message: `HTTP 连通失败：${serverBaseUrl}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

type RelayResponse =
  | { type: "client_connected" }
  | { type: "client_error"; reason: "server_offline" | "unknown_username" };

export function probeRelayRouting(
  relayUrl: string,
  relayUsername: string,
  timeoutMs = 10000,
): Promise<ProbeResult> {
  const wsUrl = toRelayWsUrl(relayUrl);
  return new Promise((resolve) => {
    let done = false;
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      socket.close();
      resolve({
        state: "failed",
        message: `中继握手超时（${timeoutMs}ms）：${wsUrl}`,
      });
    }, timeoutMs);

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "client_connect",
          username: relayUsername,
        }),
      );
    };

    socket.onmessage = (event) => {
      if (done) return;
      try {
        const data = JSON.parse(String(event.data)) as RelayResponse;
        if (data.type === "client_connected") {
          done = true;
          clearTimeout(timer);
          socket.close();
          resolve({
            state: "connected",
            message: `中继连通成功（${relayUsername}）`,
          });
          return;
        }
        if (data.type === "client_error") {
          done = true;
          clearTimeout(timer);
          socket.close();
          resolve({
            state: "failed",
            message: `中继连接失败：${data.reason}`,
          });
        }
      } catch {
        // Ignore non-JSON relay frames during probe.
      }
    };

    socket.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        state: "failed",
        message: `无法连接中继：${wsUrl}`,
      });
    };
  });
}
