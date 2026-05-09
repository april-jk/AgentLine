import type { ForwardMode } from "../lib/forwarding/layer";

export type RootStackParamList = {
  Login:
    | {
        selectedHostUrl?: string;
        connectOnSelect?: boolean;
      }
    | undefined;
  SearchHosts: {
    currentServerUrl: string;
    recentServers: string[];
    scanPrefix: string;
    scanPort: string;
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
