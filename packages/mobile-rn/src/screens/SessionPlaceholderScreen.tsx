import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { RootStackParamList } from "../navigation/types";
import { theme } from "../styles/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Console">;

export function SessionPlaceholderScreen({ route }: Props) {
  const { url, mode, source, injectedJavaScriptBeforeContentLoaded } =
    route.params;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.modeBar}>
        <Text style={styles.modeText}>
          转发层模式：{mode === "direct" ? "直连" : "中转"}
        </Text>
        <Text style={styles.urlText} numberOfLines={1}>
          {url}
        </Text>
      </View>

      <WebView
        source={source}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        injectedJavaScriptBeforeContentLoaded={
          injectedJavaScriptBeforeContentLoaded
        }
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.primary} />
            <Text style={styles.loadingText}>正在加载控制台...</Text>
          </View>
        )}
        renderError={(errorName) => (
          <View style={styles.loadingWrap}>
            <Text style={styles.errorText}>页面加载失败：{errorName}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  modeBar: {
    backgroundColor: theme.panel,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "700",
  },
  urlText: {
    color: theme.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.bg,
    gap: 8,
  },
  loadingText: {
    color: theme.textSecondary,
  },
  errorText: {
    color: theme.danger,
    paddingHorizontal: 16,
    textAlign: "center",
  },
});
