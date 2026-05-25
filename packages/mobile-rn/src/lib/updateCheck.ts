import { type UpdateManifest, fetchAgentLineUpdate } from "@agentline/shared";
import { Alert, Linking, Platform } from "react-native";
import packageJson from "../../package.json";
import {
  getSecureItem,
  secureStorageKeys,
  setSecureItem,
} from "./storage/secureStorage";
import { getNativeUpdateUrl } from "./updateDownloads";

async function openUpdateUrl(update: UpdateManifest): Promise<void> {
  const url = getNativeUpdateUrl(
    update,
    Platform.OS === "ios" ? "ios" : "android",
  );
  if (!url) return;
  await Linking.openURL(url);
}

export async function checkForNativeUpdate(options?: {
  silent?: boolean;
}): Promise<void> {
  const currentVersion = packageJson.version;
  try {
    const result = await fetchAgentLineUpdate(
      currentVersion,
      `AgentLine-Mobile-RN/${currentVersion}`,
    );
    if (result.status === "current") {
      if (!options?.silent) {
        Alert.alert("已是最新版本", `AgentLine v${currentVersion} 已是最新。`);
      }
      return;
    }

    const update = result.update;
    const dismissedVersion = await getSecureItem(
      secureStorageKeys.dismissedUpdateVersion,
    );
    if (dismissedVersion === update.version) return;

    Alert.alert(
      "发现新版本",
      `AgentLine v${update.version} 已可用，当前版本是 v${currentVersion}。`,
      [
        {
          text: "稍后",
          style: "cancel",
          onPress: () => {
            void setSecureItem(
              secureStorageKeys.dismissedUpdateVersion,
              update.version,
            );
          },
        },
        {
          text: "下载更新",
          onPress: () => {
            void setSecureItem(
              secureStorageKeys.dismissedUpdateVersion,
              update.version,
            );
            void openUpdateUrl(update);
          },
        },
      ],
    );
  } catch (error) {
    // Update checks must never block app startup.
    if (!options?.silent) {
      Alert.alert(
        "检查更新失败",
        error instanceof Error ? error.message : "请稍后再试。",
      );
    }
  }
}
