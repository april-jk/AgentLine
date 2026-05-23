export {
  DEFAULT_CONTROL_PLANE_URL,
  DEFAULT_RELAY_WS_URL,
} from "@agentline/shared";
import {
  DEFAULT_CONTROL_PLANE_URL,
  DEFAULT_RELAY_WS_URL,
} from "@agentline/shared";

const CONTROL_PLANE_ERROR_LABELS: Record<string, string> = {
  control_plane_base_url_required: "请输入平台地址。",
  control_plane_base_url_invalid: "平台地址格式无效，请检查 URL。",
  control_plane_base_url_invalid_protocol:
    "平台地址协议无效，仅支持 http:// 或 https://。",
  control_plane_dns_unresolved: "无法解析平台域名，请检查网络或 DNS 配置。",
  control_plane_connection_refused:
    "平台服务拒绝连接，请确认服务地址和端口是否正确。",
  control_plane_connection_reset: "连接被重置，请稍后重试。",
  control_plane_request_timeout:
    "连接平台超时（5 秒），请检查网络连通性或稍后重试。",
  control_plane_tls_error: "平台 TLS 证书校验失败，请检查 HTTPS 证书配置。",
  control_plane_network_unreachable: "网络不可达，请检查当前网络连接。",
  control_plane_fetch_failed: "请求平台失败，请检查平台地址、网络和证书配置。",
  fetch_failed: "请求失败，请检查平台地址、网络和证书配置。",
};

function extractErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const maybeCode = (value as { code?: unknown }).code;
  return typeof maybeCode === "string" && maybeCode.length > 0
    ? maybeCode
    : undefined;
}

function isRawFetchFailure(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized === "failed to fetch" || normalized === "fetch failed";
}

export function normalizeControlPlaneBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return DEFAULT_CONTROL_PLANE_URL;
  const withScheme =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("control_plane_base_url_invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("control_plane_base_url_invalid_protocol");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

export function deriveRelayWsUrl(controlPlaneUrl: string): string {
  try {
    const base = normalizeControlPlaneBaseUrl(controlPlaneUrl);
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return DEFAULT_RELAY_WS_URL;
  }
}

export function mapControlPlaneNetworkError(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith("control_plane_")) {
    return error;
  }

  if (error instanceof Error) {
    const raw = error.message.trim();
    if (
      raw.length > 0 &&
      !isRawFetchFailure(raw) &&
      !raw.toLowerCase().startsWith("api error:")
    ) {
      return error;
    }
  }

  if (error instanceof Error && isRawFetchFailure(error.message)) {
    return new Error("control_plane_fetch_failed");
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return new Error("control_plane_request_timeout");
  }

  const rootCode =
    extractErrorCode(error) ||
    extractErrorCode(
      error instanceof Error ? (error as { cause?: unknown }).cause : undefined,
    );

  switch (rootCode) {
    case "ERR_INVALID_URL":
      return new Error("control_plane_base_url_invalid");
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return new Error("control_plane_dns_unresolved");
    case "ECONNREFUSED":
      return new Error("control_plane_connection_refused");
    case "ECONNRESET":
      return new Error("control_plane_connection_reset");
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return new Error("control_plane_request_timeout");
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT":
      return new Error("control_plane_tls_error");
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      return new Error("control_plane_network_unreachable");
    default:
      break;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("failed to parse url")) {
      return new Error("control_plane_base_url_invalid");
    }
    if (message.includes("timed out")) {
      return new Error("control_plane_request_timeout");
    }
  }

  return new Error("control_plane_fetch_failed");
}

export function toControlPlaneDisplayError(error: unknown): string {
  const mapped = mapControlPlaneNetworkError(error);
  return CONTROL_PLANE_ERROR_LABELS[mapped.message] ?? mapped.message;
}
