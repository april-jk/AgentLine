import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HostListScreen } from "../screens/HostListScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { SessionPlaceholderScreen } from "../screens/SessionPlaceholderScreen";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Login">
      <Stack.Screen
        name="Login"
        component={LoginScreen}
        options={{ title: "登录" }}
      />
      <Stack.Screen
        name="HostList"
        component={HostListScreen}
        options={{ title: "主机列表" }}
      />
      <Stack.Screen
        name="Session"
        component={SessionPlaceholderScreen}
        options={{ title: "会话" }}
      />
    </Stack.Navigator>
  );
}
