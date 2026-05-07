import { StyleSheet, Text, View } from "react-native";
import { theme } from "../styles/theme";

export function HostListScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>HostList 已被 WebView 控制台模式替代</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.bg,
  },
  text: {
    color: theme.textSecondary,
  },
});
