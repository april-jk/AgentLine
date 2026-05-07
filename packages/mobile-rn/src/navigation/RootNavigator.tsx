import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { LoginScreen } from "../screens/LoginScreen";
import { SessionPlaceholderScreen } from "../screens/SessionPlaceholderScreen";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Login">
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: "连接" }} />
      <Stack.Screen name="Console" component={SessionPlaceholderScreen} options={{ title: "控制台" }} />
    </Stack.Navigator>
  );
}
