export type RootStackParamList = {
  Login: undefined;
  HostList: undefined;
  Session: {
    hostId: string;
    relayUsername: string;
    hostName: string;
    mode: "relay" | "direct";
    directServerUrl?: string;
    directUsername?: string;
  };
};
