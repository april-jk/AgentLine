import type { ReleaseDownload, UpdateManifest } from "@agentline/shared";
import { Alert, Linking, Platform } from "react-native";
import packageJson from "../../package.json";
import {
  getSecureItem,
  secureStorageKeys,
  setSecureItem,
} from "./storage/secureStorage";

const UPDATE_URL = "https://relay.oneceo.ai/version";

function selectDownload(update: UpdateManifest): ReleaseDownload | null {
  const platform = Platform.OS === "android" ? "android" : "ios";
  const platformDownloads = update.downloads.filter(
    (download) => download.platform === platform,
  );
  const preferred =
    platformDownloads.find((download) => download.kind === "apk") ??
    platformDownloads.find((download) => download.kind !== "aab") ??
    platformDownloads[0];
  return preferred ?? null;
}

async function openUpdateUrl(update: UpdateManifest): Promise<void> {
  const download = selectDownload(update);
  const url = download?.url ?? update.releaseUrl;
  await Linking.openURL(url);
}

export async function checkForNativeUpdate(): Promise<void> {
  const currentVersion = packageJson.version;
  try {
    const response = await fetch(`${UPDATE_URL}/${currentVersion}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": `AgentLine-Mobile-RN/${currentVersion}`,
      },
    });
    if (response.status === 204 || !response.ok) return;

    const update = (await response.json()) as UpdateManifest;
    if (!update.version || !update.releaseUrl) return;

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
  } catch {
    // Update checks must never block app startup.
  }
}
