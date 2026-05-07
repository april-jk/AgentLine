import type { ForwardMode } from "../lib/forwarding/layer";

export type RootStackParamList = {
  Login: undefined;
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
