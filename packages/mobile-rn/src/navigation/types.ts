import type { ForwardMode } from "../lib/forwarding/layer";

export type RootStackParamList = {
  Welcome: undefined;
  ConnectionMode: undefined;
  Login:
    | {
        mode?: "relay" | "direct";
        selectedHostUrl?: string;
        selectedHostInstallId?: string;
        selectedHostAccessUsername?: string;
        connectOnSelect?: boolean;
      }
    | undefined;
  SearchHosts: {
    currentServerUrl: string;
    recentServers: string[];
    scanPrefix: string;
    scanPort: string;
    knownServerUrls?: string[];
    expectedInstallIds?: string[];
  };
  RecentHosts: {
    currentServerUrl: string;
    recentServers: string[];
  };
  Console: {
    mode: ForwardMode;
    url: string;
    title: string;
    source: {
      uri: string;
    };
    injectedJavaScriptBeforeContentLoaded?: string;
  };
};
