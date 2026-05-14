import type { ThemeMode } from "../../styles/theme";
import { normalizeHttpBaseUrl } from "../api/client";

export type ForwardMode = "direct" | "relay";
const DEFAULT_REMOTE_THEME: ThemeMode = "auto";
const MOBILE_ENTRY_MARKER = "rn-shell-v1";

export type ForwardingInput =
  | {
      mode: "direct";
      directServerUrl: string;
      directUsername?: string;
      directPassword?: string;
      themeMode?: ThemeMode;
    }
  | {
      mode: "relay";
      controlPlaneUrl: string;
      relayWsUrl?: string;
      relayUsername?: string;
      relayPassword?: string;
      relayClientGrant?: string;
      themeMode?: ThemeMode;
    };

export type ForwardingWebViewSource = {
  uri: string;
};

export type ForwardingTarget = {
  mode: ForwardMode;
  url: string;
  title: string;
  source: ForwardingWebViewSource;
  injectedJavaScriptBeforeContentLoaded?: string;
};

function buildModeBootstrapScript(
  mode: ForwardMode,
  themeMode: ThemeMode = DEFAULT_REMOTE_THEME,
): string {
  return `
    window.__AGENTLINE_NATIVE_SHELL__ = true;
    window.__AGENTLINE_FORWARD_MODE__ = ${JSON.stringify(mode)};
    try {
      const themeMode = ${JSON.stringify(themeMode)};
      localStorage.setItem("agentline-theme", themeMode);
      document.documentElement.setAttribute("data-theme", themeMode);

      const postTheme = () => {
        try {
          window.ReactNativeWebView?.postMessage(
            JSON.stringify({
              type: "agentline-theme",
              value:
                document.documentElement.getAttribute("data-theme") ??
                themeMode,
            }),
          );
        } catch {}
      };

      postTheme();
      new MutationObserver(postTheme).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    } catch {}
    true;
  `;
}

function appendMobileEntryMarker(url: string): string {
  const [withoutHashRaw, hash = ""] = url.split("#", 2);
  const withoutHash = withoutHashRaw ?? "";
  if (withoutHash.includes("mobile_entry=")) return url;
  const separator = withoutHash.includes("?") ? "&" : "?";
  const withMarker =
    `${withoutHash}${separator}` +
    `mobile_entry=${encodeURIComponent(MOBILE_ENTRY_MARKER)}`;
  return hash ? `${withMarker}#${hash}` : withMarker;
}

function normalizeRelayWebBaseUrl(controlPlaneUrl: string): string {
  const base = normalizeHttpBaseUrl(controlPlaneUrl);
  if (base.endsWith("/remote/login/relay")) {
    return base.slice(0, -"/remote/login/relay".length);
  }
  if (base.endsWith("/remote")) return base.slice(0, -"/remote".length);
  return base;
}

function isLocalRemoteDevBase(baseUrl: string): boolean {
  return /^(http:\/\/)(127\.0\.0\.1|localhost|10\.0\.2\.2)(:\d+)?$/.test(
    baseUrl,
  );
}

function normalizeRelayEntryUrl(
  controlPlaneUrl: string,
  relayUsername?: string,
): string {
  const base = normalizeRelayWebBaseUrl(controlPlaneUrl);
  const username = relayUsername?.trim().toLowerCase();
  if (isLocalRemoteDevBase(base)) {
    if (username) {
      return `${base}/${encodeURIComponent(username)}/projects`;
    }
    return `${base}/projects`;
  }
  if (username) {
    return `${base}/remote/${encodeURIComponent(username)}/projects`;
  }
  return `${base}/remote/projects`;
}

function normalizeDirectWebBaseUrl(directServerUrl: string): string {
  const base = normalizeHttpBaseUrl(directServerUrl);
  if (base.endsWith("/remote/login/direct")) {
    return base.slice(0, -"/remote/login/direct".length);
  }
  if (base.endsWith("/login/direct")) {
    return base.slice(0, -"/login/direct".length);
  }
  if (base.endsWith("/remote")) return base.slice(0, -"/remote".length);
  return base;
}

function parseBaseUrlParts(base: string): {
  protocol: string;
  host: string;
  port: number;
} | null {
  const match = base.match(/^(https?:)\/\/([^/:]+)(?::(\d+))?$/);
  if (!match?.[1] || !match[2]) return null;

  return {
    protocol: match[1],
    host: match[2],
    port: Number(match[3] || (match[1] === "https:" ? 443 : 80)),
  };
}

function isLoopbackOrEmulatorHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "10.0.2.2";
}

function normalizeDirectEntryUrl(directServerUrl: string): string {
  const base = normalizeDirectWebBaseUrl(directServerUrl);
  const parsed = parseBaseUrlParts(base);
  if (parsed && isLoopbackOrEmulatorHost(parsed.host)) {
    return `${parsed.protocol}//${parsed.host}:${String(parsed.port + 2)}/projects`;
  }
  if (isLocalRemoteDevBase(base)) {
    return `${base}/projects`;
  }
  return `${base}/remote/projects`;
}

function normalizeDirectWsUrl(rawValue: string): string {
  const base = normalizeHttpBaseUrl(rawValue);
  const value = base.replace(/^http/, "ws");
  if (value.endsWith("/api/ws")) return value;
  return `${value}/api/ws`;
}

function normalizeRelayWsUrl(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return "wss://relay.oneceo.ai/ws";
  }

  let value = trimmed;
  if (value.startsWith("http://")) {
    value = value.replace("http://", "ws://");
  } else if (value.startsWith("https://")) {
    value = value.replace("https://", "wss://");
  } else if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
    value = `wss://${value}`;
  }

  if (!value.endsWith("/ws")) {
    value = `${value.replace(/\/+$/, "")}/ws`;
  }

  return value;
}

function buildRelayHash(
  input: Extract<ForwardingInput, { mode: "relay" }>,
): string {
  const params: string[] = [];
  const username = input.relayUsername?.trim().toLowerCase();
  const password = input.relayPassword?.trim();
  const clientGrant = input.relayClientGrant?.trim();
  const relayWsUrl = normalizeRelayWsUrl(input.relayWsUrl ?? "");

  if (username) params.push(`u=${encodeURIComponent(username)}`);
  if (password) params.push(`p=${encodeURIComponent(password)}`);
  if (clientGrant) params.push(`cg=${encodeURIComponent(clientGrant)}`);
  params.push(`r=${encodeURIComponent(relayWsUrl)}`);

  const serialized = params.join("&");
  return serialized ? `#${serialized}` : "";
}

function buildDirectHash(
  input: Extract<ForwardingInput, { mode: "direct" }>,
): string {
  const params: string[] = [];
  const wsUrl = normalizeDirectWsUrl(input.directServerUrl);
  const username = input.directUsername?.trim();
  const password = input.directPassword?.trim();

  params.push(`ws=${encodeURIComponent(wsUrl)}`);
  if (username) params.push(`u=${encodeURIComponent(username)}`);
  if (password) params.push(`p=${encodeURIComponent(password)}`);

  const serialized = params.join("&");
  return serialized ? `#${serialized}` : "";
}

export function resolveForwardingTarget(
  input: ForwardingInput,
): ForwardingTarget {
  if (input.mode === "direct") {
    const directServerUrl = normalizeHttpBaseUrl(input.directServerUrl);
    const url = appendMobileEntryMarker(
      `${normalizeDirectEntryUrl(input.directServerUrl)}${buildDirectHash(input)}`,
    );
    return {
      mode: "direct",
      url: directServerUrl,
      title: "AgentLine 直连",
      source: { uri: url },
      injectedJavaScriptBeforeContentLoaded: buildModeBootstrapScript(
        "direct",
        input.themeMode,
      ),
    };
  }

  const url = appendMobileEntryMarker(
    `${normalizeRelayEntryUrl(input.controlPlaneUrl, input.relayUsername)}${buildRelayHash(input)}`,
  );
  const controlPlaneBaseUrl = normalizeRelayWebBaseUrl(input.controlPlaneUrl);
  return {
    mode: "relay",
    url: controlPlaneBaseUrl,
    title: "AgentLine 中转",
    source: { uri: url },
    injectedJavaScriptBeforeContentLoaded: buildModeBootstrapScript(
      "relay",
      input.themeMode,
    ),
  };
}
