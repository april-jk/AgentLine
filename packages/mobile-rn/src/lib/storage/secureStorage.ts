import * as SecureStore from "expo-secure-store";

export async function setSecureItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function getSecureItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function deleteSecureItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

export const secureStorageKeys = {
  accessToken: "agentline.access_token",
  mobileOnboardingDone: "agentline.mobile_onboarding_done",
  uiThemeMode: "agentline.ui_theme_mode",
  controlPlaneUrl: "agentline.control_plane_url",
  controlPlaneAccessToken: "agentline.control_plane_access_token",
  controlPlaneAccountEmail: "agentline.control_plane_account_email",
  selectedRelayDeviceId: "agentline.selected_relay_device_id",
  relayWsUrl: "agentline.relay_ws_url",
  relayUsername: "agentline.relay_username",
  relayPassword: "agentline.relay_password",
  hostAccessPasswords: "agentline.host_access_passwords",
  directServerUrl: "agentline.direct_server_url",
  directUsername: "agentline.direct_username",
  directPassword: "agentline.direct_password",
  recentDirectServers: "agentline.recent_direct_servers",
  connectionMode: "agentline.connection_mode",
} as const;
