import { SidebarIcons } from "./components/SidebarNavItem";
import type { FontSize } from "./hooks/useFontSize";
import type { TabSize } from "./hooks/useTabSize";
import type { Theme } from "./hooks/useTheme";
import type { Locale } from "./i18n";
import type { SettingsCategory } from "./pages/settings/types";

const settingsIcons = {
  appearance: SidebarIcons.settings,
  model: SidebarIcons.agents,
  agentContext: SidebarIcons.allSessions,
  notifications: SidebarIcons.inbox,
  webhooks: SidebarIcons.sourceControl,
  phone: SidebarIcons.voiceSecretary,
  devices: SidebarIcons.emulator,
  localAccess: SidebarIcons.settings,
  remote: SidebarIcons.projects,
  providers: SidebarIcons.sourceControl,
  remoteExecutors: SidebarIcons.emulator,
  about: SidebarIcons.settings,
  emulator: SidebarIcons.emulator,
  development: SidebarIcons.settings,
} as const;

export function getThemeLabel(
  theme: Theme,
  t: (key: string) => string,
): string {
  switch (theme) {
    case "auto":
      return t("themeAuto");
    case "light":
      return t("themeLight");
    case "dark":
      return t("themeDark");
    case "verydark":
      return t("themeVerydark");
  }
}

export function getFontSizeLabel(
  size: FontSize,
  t: (key: string) => string,
): string {
  switch (size) {
    case "small":
      return t("fontSizeSmall");
    case "default":
      return t("fontSizeDefault");
    case "large":
      return t("fontSizeLarge");
    case "larger":
      return t("fontSizeLarger");
  }
}

export function getTabSizeLabel(size: TabSize): string {
  return size;
}

export function getLocaleLabel(
  locale: Locale,
  t: (key: string) => string,
): string {
  switch (locale) {
    case "en":
      return t("localeNameEn");
    case "zh-CN":
      return t("localeNameZhCn");
    case "es":
      return t("localeNameEs");
    case "fr":
      return t("localeNameFr");
    case "de":
      return t("localeNameDe");
    case "ja":
      return t("localeNameJa");
  }
}

export function getSettingsCategories(
  t: (key: string) => string,
): SettingsCategory[] {
  return [
    {
      id: "appearance",
      label: t("settingsAppearanceTitle"),
      icon: settingsIcons.appearance,
      description: t("settingsAppearanceDescription"),
    },
    {
      id: "model",
      label: t("settingsModelTitle"),
      icon: settingsIcons.model,
      description: t("settingsModelDescription"),
    },
    {
      id: "agent-context",
      label: t("settingsAgentContextTitle"),
      icon: settingsIcons.agentContext,
      description: t("settingsAgentContextDescription"),
    },
    {
      id: "notifications",
      label: t("settingsNotificationsTitle"),
      icon: settingsIcons.notifications,
      description: t("settingsNotificationsDescription"),
    },
    {
      id: "webhooks",
      label: t("settingsWebhooksTitle"),
      icon: settingsIcons.webhooks,
      description: t("settingsWebhooksDescription"),
    },
    {
      id: "phone",
      label: t("settingsPhoneTitle"),
      icon: settingsIcons.phone,
      description: t("settingsPhoneDescription"),
    },
    {
      id: "devices",
      label: t("settingsDevicesTitle"),
      icon: settingsIcons.devices,
      description: t("settingsDevicesDescription"),
    },
    {
      id: "local-access",
      label: t("settingsLocalAccessTitle"),
      icon: settingsIcons.localAccess,
      description: t("settingsLocalAccessDescription"),
    },
    {
      id: "remote",
      label: t("settingsRemoteTitle"),
      icon: settingsIcons.remote,
      description: t("settingsRemoteDescription"),
    },
    {
      id: "providers",
      label: t("settingsProvidersTitle"),
      icon: settingsIcons.providers,
      description: t("settingsProvidersDescription"),
    },
    {
      id: "remote-executors",
      label: t("settingsRemoteExecutorsTitle"),
      icon: settingsIcons.remoteExecutors,
      description: t("settingsRemoteExecutorsDescription"),
    },
    {
      id: "about",
      label: t("settingsAboutTitle"),
      icon: settingsIcons.about,
      description: t("settingsAboutDescription"),
    },
  ];
}

export function getEmulatorCategory(
  t: (key: string) => string,
): SettingsCategory {
  return {
    id: "emulator",
    label: t("settingsEmulatorTitle"),
    icon: settingsIcons.emulator,
    description: t("settingsEmulatorDescription"),
  };
}

export function getDevelopmentCategory(
  t: (key: string) => string,
): SettingsCategory {
  return {
    id: "development",
    label: t("settingsDevelopmentTitle"),
    icon: settingsIcons.development,
    description: t("settingsDevelopmentDescription"),
  };
}
