import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type GlobalSessionItem, fetchJSON } from "../api/client";
import { useOptionalRemoteConnection } from "../contexts/RemoteConnectionContext";
import { useDrafts } from "../hooks/useDrafts";
import { useGlobalSessions } from "../hooks/useGlobalSessions";
import { useNeedsAttentionBadge } from "../hooks/useNeedsAttentionBadge";
import { resolvePreferredProjectId } from "../hooks/useRecentProject";
import { useRecentProjects } from "../hooks/useRecentProjects";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import {
  DEFAULT_CONTROL_PLANE_URL,
  deriveRelayWsUrl,
  normalizeControlPlaneBaseUrl,
  toControlPlaneDisplayError,
} from "../lib/controlPlane";
import {
  isRemoteSecureConnectionPending,
  shouldClearStoredControlPlaneAccount,
} from "../lib/controlPlaneAccountState";
import { isElectronDesktopShell } from "../lib/runtimeEnvironment";
import { getSessionDisplayTitle } from "../utils";
import { AgentLineLogo } from "./AgentLineLogo";
import { AgentsNavItem } from "./AgentsNavItem";
import { SessionListItem } from "./SessionListItem";
import {
  SidebarIcons,
  SidebarNavItem,
  SidebarNavSection,
} from "./SidebarNavItem";

const SWIPE_THRESHOLD = 50; // Minimum distance to trigger close
const SWIPE_ENGAGE_THRESHOLD = 15; // Minimum horizontal distance before swipe engages
const RECENT_SESSIONS_INITIAL = 12; // Initial number of recent sessions to show
const RECENT_SESSIONS_INCREMENT = 10; // How many more to show on each expand
const ACCOUNT_STORAGE_KEY = "agentline.remote.account";

type AccountMode = "login" | "register";

interface AccountUser {
  id: string;
  email: string;
  createdAt: string;
}

interface ControlPlaneAccountSummary {
  baseUrl?: string;
  lastEmail?: string;
  hasAccessToken: boolean;
  authenticated: boolean;
  user?: AccountUser;
  verificationError?: string;
  desktopManaged?: boolean;
}

interface DesktopApiBridge {
  getControlPlaneConfig: () => Promise<{
    baseUrl?: string;
    lastEmail?: string;
    hasAccessToken: boolean;
  }>;
  getControlPlaneAccount: () => Promise<ControlPlaneAccountSummary>;
  loginControlPlane: (payload: {
    baseUrl: string;
    email: string;
    password: string;
    relayWsUrl?: string;
  }) => Promise<{
    baseUrl?: string;
    lastEmail?: string;
    hasAccessToken: boolean;
  }>;
  registerControlPlane: (payload: {
    baseUrl: string;
    email: string;
    password: string;
    relayWsUrl?: string;
  }) => Promise<{
    baseUrl?: string;
    lastEmail?: string;
    hasAccessToken: boolean;
  }>;
  updateControlPlaneAccount: (payload: {
    currentPassword: string;
    email?: string;
    newPassword?: string;
  }) => Promise<ControlPlaneAccountSummary>;
  logoutControlPlane: () => Promise<ControlPlaneAccountSummary>;
  getRemoteAccessConfig: () => Promise<{
    enabled: boolean;
    username: string | null;
    hostAccessConfigured: boolean;
  }>;
  configureRemoteAccessPassword: (password: string) => Promise<{
    enabled: boolean;
    username: string | null;
    hostAccessConfigured: boolean;
  }>;
}

interface StoredAccountState {
  controlPlaneUrl: string;
  accessToken: string;
  email: string;
}

interface ControlPlaneBridgeStatus {
  enabled: boolean;
  running: boolean;
  pausedReason?: string;
  deviceId?: string;
  relayUsername?: string;
  lastSyncAt?: string;
  lastHeartbeatAt?: string;
  lastError?: string;
  consecutiveFailures: number;
}

interface HostAccessConfig {
  enabled: boolean;
  username: string | null;
  hostAccessConfigured: boolean;
}

function loadStoredAccountState(): StoredAccountState | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAccountState>;
    if (
      typeof parsed.controlPlaneUrl !== "string" ||
      typeof parsed.accessToken !== "string" ||
      typeof parsed.email !== "string"
    ) {
      return null;
    }
    return {
      controlPlaneUrl: parsed.controlPlaneUrl,
      accessToken: parsed.accessToken,
      email: parsed.email,
    };
  } catch {
    return null;
  }
}

function saveStoredAccountState(state: StoredAccountState): void {
  localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(state));
}

function clearStoredAccountState(): void {
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
}

function toAccountErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  const message = error.message.trim();
  if (!message) {
    return fallback;
  }
  if (
    message.startsWith("control_plane_") ||
    message === "desktop_managed_control_plane_requires_desktop_app" ||
    message.toLowerCase() === "failed to fetch" ||
    message.toLowerCase() === "fetch failed"
  ) {
    if (message === "desktop_managed_control_plane_requires_desktop_app") {
      return "此平台账号由桌面端托管，请在 AgentLine 桌面窗口中退出登录或编辑资料。";
    }
    return toControlPlaneDisplayError(error);
  }
  return message;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: () => void;

  /** Current session ID (for highlighting in sidebar) */
  currentSessionId?: string;

  /** Desktop mode: sidebar is always visible, no overlay */
  isDesktop?: boolean;
  /** Desktop mode: sidebar is collapsed (icons only) */
  isCollapsed?: boolean;
  /** Desktop mode: callback to toggle expanded/collapsed state */
  onToggleExpanded?: () => void;
  /** Desktop mode: current sidebar width in pixels */
  sidebarWidth?: number;
  /** Desktop mode: called when resize starts */
  onResizeStart?: () => void;
  /** Desktop mode: called during resize with new width */
  onResize?: (width: number) => void;
  /** Desktop mode: called when resize ends */
  onResizeEnd?: () => void;
}

export function Sidebar({
  isOpen,
  onClose,
  onNavigate,
  currentSessionId,
  // Desktop mode props
  isDesktop = false,
  isCollapsed = false,
  onToggleExpanded,
  sidebarWidth,
  onResizeStart,
  onResize,
  onResizeEnd,
}: SidebarProps) {
  const { t } = useI18n();
  // Get base path for relay mode (e.g., "/remote/my-server")
  const basePath = useRemoteBasePath();
  const navigate = useNavigate();
  const remoteConnection = useOptionalRemoteConnection();

  // Fetch global sessions for sidebar (non-starred only for recent/older sections)
  const { sessions: globalSessions, loading: globalLoading } =
    useGlobalSessions({ limit: 50, includeStats: false });

  // Fetch starred sessions separately to ensure we get ALL starred sessions
  const { sessions: starredSessions, loading: starredLoading } =
    useGlobalSessions({
      starred: true,
      limit: 100,
      includeStats: false,
    });

  const sessionsLoading = globalLoading || starredLoading;

  // Server capabilities for feature gating
  const { version: versionInfo } = useVersion();
  const capabilities = versionInfo?.capabilities ?? [];

  // Global inbox count
  const inboxCount = useNeedsAttentionBadge();
  const { recentProjects, projects } = useRecentProjects();
  const newSessionProjectId = resolvePreferredProjectId(
    projects,
    recentProjects[0]?.id,
  );

  const sidebarRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const swipeEngaged = useRef<boolean>(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef<number | null>(null);
  const resizeStartWidth = useRef<number | null>(null);
  const [recentSessionsLimit, setRecentSessionsLimit] = useState(
    RECENT_SESSIONS_INITIAL,
  );
  const [olderSessionsLimit, setOlderSessionsLimit] = useState(
    RECENT_SESSIONS_INITIAL,
  );
  const [starredSessionsLimit, setStarredSessionsLimit] = useState(
    RECENT_SESSIONS_INITIAL,
  );
  const desktopApi = (window as Window & { desktopApi?: DesktopApiBridge })
    .desktopApi;
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const accountPanelOpenRef = useRef(false);
  const [accountMode, setAccountMode] = useState<AccountMode>("login");
  const [accountBaseUrl, setAccountBaseUrl] = useState(
    DEFAULT_CONTROL_PLANE_URL,
  );
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountConfirmPassword, setAccountConfirmPassword] = useState("");
  const [accountCurrentPassword, setAccountCurrentPassword] = useState("");
  const [accountNewPassword, setAccountNewPassword] = useState("");
  const [accountConfirmNewPassword, setAccountConfirmNewPassword] =
    useState("");
  const [accountProfileEditing, setAccountProfileEditing] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<ControlPlaneAccountSummary>({
    baseUrl: DEFAULT_CONTROL_PLANE_URL,
    hasAccessToken: false,
    authenticated: false,
  });
  const [accountProfileEmail, setAccountProfileEmail] = useState("");
  const [hostAccessConfig, setHostAccessConfig] =
    useState<HostAccessConfig | null>(null);
  const [hostAccessPassword, setHostAccessPassword] = useState("");
  const [hostAccessPasswordConfirm, setHostAccessPasswordConfirm] =
    useState("");
  const [requireAccessPasswordSetup, setRequireAccessPasswordSetup] =
    useState(false);

  const applyAccountSummary = useCallback(
    (account: ControlPlaneAccountSummary) => {
      const email = account.user?.email ?? account.lastEmail ?? "";
      setAccountInfo(account);
      setAccountBaseUrl(account.baseUrl ?? DEFAULT_CONTROL_PLANE_URL);
      setAccountEmail(email);
      setAccountProfileEmail(email);
    },
    [],
  );

  const resetAccountSummary = useCallback(
    (baseUrl = DEFAULT_CONTROL_PLANE_URL, lastEmail = "") => {
      setAccountInfo({
        baseUrl,
        lastEmail: lastEmail || undefined,
        hasAccessToken: false,
        authenticated: false,
      });
      setHostAccessConfig(null);
      setRequireAccessPasswordSetup(false);
      setHostAccessPassword("");
      setHostAccessPasswordConfirm("");
      setAccountBaseUrl(baseUrl);
      setAccountEmail(lastEmail);
      setAccountProfileEmail(lastEmail);
    },
    [],
  );

  const refreshHostAccessConfig =
    useCallback(async (): Promise<HostAccessConfig | null> => {
      try {
        const nextConfig = desktopApi
          ? await desktopApi.getRemoteAccessConfig()
          : await fetchJSON<HostAccessConfig>("/remote-access/config");
        setHostAccessConfig(nextConfig);
        return nextConfig;
      } catch {
        setHostAccessConfig(null);
        return null;
      }
    }, [desktopApi]);

  const refreshHostManagedAccountState =
    useCallback(async (): Promise<ControlPlaneAccountSummary | null> => {
      try {
        const account = await fetchJSON<ControlPlaneAccountSummary>(
          "/remote-access/control-plane/account",
        );
        if (!account.hasAccessToken && !account.lastEmail) {
          return null;
        }
        applyAccountSummary(account);
        const currentHostAccess = await refreshHostAccessConfig();
        setRequireAccessPasswordSetup(
          account.authenticated && !currentHostAccess?.hostAccessConfigured,
        );
        return account;
      } catch {
        return null;
      }
    }, [applyAccountSummary, refreshHostAccessConfig]);

  const configureLocalControlPlaneBridge = useCallback(
    async (params: {
      baseUrl: string;
      accessToken: string;
      email?: string;
    }): Promise<ControlPlaneBridgeStatus> => {
      const payload = await fetchJSON<{
        success?: boolean;
        state: ControlPlaneBridgeStatus;
      }>("/remote-access/control-plane/config", {
        method: "PUT",
        body: JSON.stringify({
          baseUrl: params.baseUrl,
          accessToken: params.accessToken,
          relayWsUrl: deriveRelayWsUrl(params.baseUrl),
          lastEmail: params.email,
        }),
      });
      return payload.state;
    },
    [],
  );

  const clearLocalControlPlaneBridge = useCallback(async (): Promise<void> => {
    await fetchJSON<{ success: boolean }>(
      "/remote-access/control-plane/config",
      {
        method: "DELETE",
      },
    );
  }, []);

  const refreshAccountState = useCallback(async () => {
    if (desktopApi) {
      try {
        const account = await desktopApi.getControlPlaneAccount();
        applyAccountSummary(account);
        const currentHostAccess = await refreshHostAccessConfig();
        setRequireAccessPasswordSetup(
          account.authenticated && !currentHostAccess?.hostAccessConfigured,
        );
      } catch {
        resetAccountSummary();
      }
      return;
    }

    const stored = loadStoredAccountState();
    if (!stored) {
      const hostAccount = await refreshHostManagedAccountState();
      if (hostAccount) {
        return;
      }
      resetAccountSummary();
      return;
    }
    const baseUrl = normalizeControlPlaneBaseUrl(stored.controlPlaneUrl);
    setAccountBaseUrl(baseUrl);
    setAccountEmail(stored.email);
    setAccountProfileEmail(stored.email);
    try {
      const payload = await fetchJSON<{ user: AccountUser }>(
        "/remote-access/control-plane/me",
        {
          method: "POST",
          body: JSON.stringify({
            baseUrl,
            accessToken: stored.accessToken,
          }),
        },
      );
      setAccountInfo({
        baseUrl,
        lastEmail: payload.user.email,
        hasAccessToken: true,
        authenticated: true,
        user: payload.user,
      });
      setAccountEmail(payload.user.email);
      setAccountProfileEmail(payload.user.email);
      saveStoredAccountState({
        controlPlaneUrl: baseUrl,
        accessToken: stored.accessToken,
        email: payload.user.email,
      });
      try {
        await configureLocalControlPlaneBridge({
          baseUrl,
          accessToken: stored.accessToken,
          email: payload.user.email,
        });
      } catch (error) {
        console.warn(
          "[Sidebar] Failed to refresh local control-plane bridge config:",
          error,
        );
      }
      const currentHostAccess = await refreshHostAccessConfig();
      setRequireAccessPasswordSetup(!currentHostAccess?.hostAccessConfigured);
    } catch (error) {
      if (isRemoteSecureConnectionPending(error)) {
        setAccountInfo({
          baseUrl,
          lastEmail: stored.email,
          hasAccessToken: true,
          authenticated: false,
        });
        return;
      }

      const shouldClearStoredAccount =
        shouldClearStoredControlPlaneAccount(error);

      if (shouldClearStoredAccount) {
        clearStoredAccountState();
      }

      const hostAccount = await refreshHostManagedAccountState();
      if (!hostAccount) {
        if (shouldClearStoredAccount) {
          resetAccountSummary(baseUrl, stored.email);
          return;
        }

        setAccountInfo({
          baseUrl,
          lastEmail: stored.email,
          hasAccessToken: true,
          authenticated: false,
          verificationError: toAccountErrorMessage(
            error,
            "account_verification_pending",
          ),
        });
        setAccountBaseUrl(baseUrl);
        setAccountEmail(stored.email);
        setAccountProfileEmail(stored.email);
      }
    }
  }, [
    applyAccountSummary,
    configureLocalControlPlaneBridge,
    desktopApi,
    refreshHostAccessConfig,
    refreshHostManagedAccountState,
    resetAccountSummary,
  ]);

  useEffect(() => {
    void refreshAccountState();
  }, [refreshAccountState]);

  useEffect(() => {
    if (!remoteConnection?.connection) {
      return;
    }
    void refreshAccountState();
  }, [remoteConnection?.connection, refreshAccountState]);

  useEffect(() => {
    accountPanelOpenRef.current = accountPanelOpen;
  }, [accountPanelOpen]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (accountPanelOpenRef.current) {
        return;
      }
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      void refreshAccountState();
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshAccountState]);

  useEffect(() => {
    if (!accountPanelOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !requireAccessPasswordSetup) {
        setAccountPanelOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [accountPanelOpen, requireAccessPasswordSetup]);

  const resetAccountFormState = useCallback(() => {
    setAccountError(null);
    setAccountPassword("");
    setAccountConfirmPassword("");
    setAccountCurrentPassword("");
    setAccountNewPassword("");
    setAccountConfirmNewPassword("");
    setAccountProfileEditing(false);
  }, []);

  const isAccountLoggedIn =
    accountInfo.authenticated && Boolean(accountInfo.user);
  const isDesktopShell = isElectronDesktopShell({
    hasDesktopApi: Boolean(desktopApi),
  });
  const isDesktopManagedWithoutBridge =
    Boolean(accountInfo.desktopManaged) && !isDesktopShell;
  const accountStatusLabel = isAccountLoggedIn
    ? "已登录"
    : accountInfo.hasAccessToken
      ? accountInfo.verificationError
        ? "登录待验证"
        : "已保存登录"
      : "未登录";

  useEffect(() => {
    if (accountInfo.user?.email) {
      setAccountProfileEmail(accountInfo.user.email);
      setAccountEmail(accountInfo.user.email);
    }
  }, [accountInfo.user?.email]);

  useEffect(() => {
    if (!isAccountLoggedIn) {
      setAccountProfileEditing(false);
      setRequireAccessPasswordSetup(false);
      setHostAccessPassword("");
      setHostAccessPasswordConfirm("");
    }
  }, [isAccountLoggedIn]);

  useEffect(() => {
    if (isDesktopManagedWithoutBridge) {
      setAccountProfileEditing(false);
    }
  }, [isDesktopManagedWithoutBridge]);

  const configureHostAccessPassword = async () => {
    if (!hostAccessPassword.trim()) {
      setAccountError("访问密码不能为空。");
      return;
    }
    if (hostAccessPassword.length < 8) {
      setAccountError("访问密码至少 8 位。");
      return;
    }
    if (hostAccessPassword !== hostAccessPasswordConfirm) {
      setAccountError("两次输入的访问密码不一致。");
      return;
    }

    setAccountBusy(true);
    setAccountError(null);
    try {
      if (desktopApi) {
        const nextConfig =
          await desktopApi.configureRemoteAccessPassword(hostAccessPassword);
        setHostAccessConfig(nextConfig);
      } else {
        await fetchJSON<{ success: boolean; username: string | null }>(
          "/remote-access/configure",
          {
            method: "POST",
            body: JSON.stringify({ password: hostAccessPassword }),
          },
        );
        await refreshHostAccessConfig();
      }

      const latest = desktopApi
        ? await desktopApi.getRemoteAccessConfig()
        : await fetchJSON<HostAccessConfig>("/remote-access/config");
      setHostAccessConfig(latest);
      const stillRequired = !latest.hostAccessConfigured;
      setRequireAccessPasswordSetup(stillRequired);
      if (stillRequired) {
        throw new Error("access_password_not_applied");
      }
      setHostAccessPassword("");
      setHostAccessPasswordConfirm("");
      setAccountError(null);
    } catch (error) {
      setAccountError(
        toAccountErrorMessage(error, "访问密码设置失败，请重试。"),
      );
    } finally {
      setAccountBusy(false);
    }
  };

  const handleAccountAuthSubmit = () => {
    if (!accountEmail.trim() || !accountPassword.trim()) {
      setAccountError("Email and password are required.");
      return;
    }
    if (
      accountMode === "register" &&
      accountPassword !== accountConfirmPassword
    ) {
      setAccountError("Passwords do not match.");
      return;
    }

    setAccountBusy(true);
    setAccountError(null);

    const run = async () => {
      if (desktopApi) {
        const payload = {
          baseUrl: normalizeControlPlaneBaseUrl(accountBaseUrl),
          email: accountEmail.trim(),
          password: accountPassword,
        };
        if (accountMode === "register") {
          await desktopApi.registerControlPlane(payload);
        } else {
          await desktopApi.loginControlPlane(payload);
        }
        setAccountPassword("");
        setAccountConfirmPassword("");
        await refreshAccountState();
        const nextHostAccess = await desktopApi.getRemoteAccessConfig();
        setHostAccessConfig(nextHostAccess);
        if (!nextHostAccess.hostAccessConfigured) {
          setRequireAccessPasswordSetup(true);
          setAccountPanelOpen(true);
          setAccountError("登录成功，请先设置访问密码后再继续。");
        }
        return;
      }

      const baseUrl = normalizeControlPlaneBaseUrl(accountBaseUrl);
      const credentials = {
        email: accountEmail.trim(),
        password: accountPassword,
      };
      const payload = await fetchJSON<{
        baseUrl?: string;
        accessToken: string;
      }>("/remote-access/control-plane/auth", {
        method: "POST",
        body: JSON.stringify({
          mode: accountMode,
          baseUrl,
          email: credentials.email,
          password: credentials.password,
        }),
      });
      const bridgeState = await configureLocalControlPlaneBridge({
        baseUrl,
        accessToken: payload.accessToken,
        email: credentials.email,
      });
      if (!bridgeState.deviceId || !bridgeState.relayUsername) {
        throw new Error(
          bridgeState.lastError ?? "control_plane_bridge_sync_failed",
        );
      }
      saveStoredAccountState({
        controlPlaneUrl: baseUrl,
        accessToken: payload.accessToken,
        email: credentials.email,
      });
      setAccountPassword("");
      setAccountConfirmPassword("");
      await refreshAccountState();
      const nextHostAccess = await refreshHostAccessConfig();
      if (!nextHostAccess?.hostAccessConfigured) {
        setRequireAccessPasswordSetup(true);
        setAccountPanelOpen(true);
        setAccountError("登录成功，请先设置访问密码后再继续。");
      }
    };

    void run()
      .catch((error: unknown) => {
        setAccountError(toAccountErrorMessage(error, "Authentication failed"));
      })
      .finally(() => setAccountBusy(false));
  };

  const handleAccountProfileSave = () => {
    if (!accountCurrentPassword.trim()) {
      setAccountError("Current password is required.");
      return;
    }
    if (
      accountNewPassword.trim().length > 0 &&
      accountNewPassword !== accountConfirmNewPassword
    ) {
      setAccountError("New passwords do not match.");
      return;
    }
    const emailChanged =
      accountProfileEmail.trim() !== (accountInfo.user?.email ?? "").trim();
    const wantsPasswordChange = accountNewPassword.trim().length > 0;
    if (!emailChanged && !wantsPasswordChange) {
      setAccountError("No changes to save.");
      return;
    }

    setAccountBusy(true);
    setAccountError(null);

    const run = async () => {
      if (desktopApi) {
        const summary = await desktopApi.updateControlPlaneAccount({
          currentPassword: accountCurrentPassword,
          email: emailChanged ? accountProfileEmail.trim() : undefined,
          newPassword: wantsPasswordChange ? accountNewPassword : undefined,
        });
        setAccountInfo(summary);
      } else {
        const stored = loadStoredAccountState();
        if (!stored && !accountInfo.hasAccessToken) {
          throw new Error("not_logged_in");
        }
        if (!stored && isDesktopManagedWithoutBridge) {
          throw new Error("desktop_managed_control_plane_requires_desktop_app");
        }
        const baseUrl = stored
          ? normalizeControlPlaneBaseUrl(stored.controlPlaneUrl)
          : normalizeControlPlaneBaseUrl(
              accountInfo.baseUrl ?? DEFAULT_CONTROL_PLANE_URL,
            );
        const payload = await fetchJSON<{ user: AccountUser }>(
          "/remote-access/control-plane/me",
          {
            method: "PATCH",
            body: JSON.stringify({
              ...(stored ? { baseUrl, accessToken: stored.accessToken } : {}),
              currentPassword: accountCurrentPassword,
              email: emailChanged ? accountProfileEmail.trim() : undefined,
              newPassword: wantsPasswordChange ? accountNewPassword : undefined,
            }),
          },
        );
        setAccountInfo({
          baseUrl,
          lastEmail: payload.user.email,
          hasAccessToken: true,
          authenticated: true,
          user: payload.user,
        });
        if (stored) {
          saveStoredAccountState({
            controlPlaneUrl: baseUrl,
            accessToken: stored.accessToken,
            email: payload.user.email,
          });
          try {
            await configureLocalControlPlaneBridge({
              baseUrl,
              accessToken: stored.accessToken,
              email: payload.user.email,
            });
          } catch (error) {
            console.warn(
              "[Sidebar] Failed to refresh local bridge after profile update:",
              error,
            );
          }
        }
      }

      setAccountCurrentPassword("");
      setAccountNewPassword("");
      setAccountConfirmNewPassword("");
      setAccountProfileEditing(false);
      await refreshAccountState();
    };

    void run()
      .catch((error: unknown) => {
        setAccountError(toAccountErrorMessage(error, "Update failed"));
      })
      .finally(() => setAccountBusy(false));
  };

  const handleAccountLogout = () => {
    setAccountBusy(true);
    setAccountError(null);
    const run = async () => {
      if (desktopApi) {
        await desktopApi.logoutControlPlane();
      } else {
        const stored = loadStoredAccountState();
        if (!stored && isDesktopManagedWithoutBridge) {
          throw new Error("desktop_managed_control_plane_requires_desktop_app");
        }
        if (stored) {
          const baseUrl = normalizeControlPlaneBaseUrl(stored.controlPlaneUrl);
          await fetchJSON<{ success: boolean }>(
            "/remote-access/control-plane/auth/logout",
            {
              method: "POST",
              body: JSON.stringify({
                baseUrl,
                accessToken: stored.accessToken,
              }),
            },
          ).catch(() => undefined);
        } else if (accountInfo.hasAccessToken) {
          await fetchJSON<{ success: boolean }>(
            "/remote-access/control-plane/auth/logout",
            {
              method: "POST",
              body: JSON.stringify({}),
            },
          ).catch(() => undefined);
        }
        clearStoredAccountState();
        await clearLocalControlPlaneBridge().catch((error) => {
          console.warn(
            "[Sidebar] Failed to clear local control-plane bridge config:",
            error,
          );
        });
      }
      setHostAccessConfig(null);
      setRequireAccessPasswordSetup(false);
      setHostAccessPassword("");
      setHostAccessPasswordConfirm("");
      setAccountPassword("");
      setAccountConfirmPassword("");
      setAccountCurrentPassword("");
      setAccountNewPassword("");
      setAccountConfirmNewPassword("");
      setAccountProfileEditing(false);
      await refreshAccountState();
      setAccountPanelOpen(false);
    };

    void run()
      .catch((error: unknown) => {
        setAccountError(toAccountErrorMessage(error, "Logout failed"));
      })
      .finally(() => setAccountBusy(false));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    touchStartY.current = e.touches[0]?.clientY ?? null;
    swipeEngaged.current = false;
    setSwipeOffset(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const currentX = e.touches[0]?.clientX;
    const currentY = e.touches[0]?.clientY;
    if (currentX === undefined || currentY === undefined) return;

    const diffX = currentX - touchStartX.current;
    const diffY = currentY - touchStartY.current;

    // If not yet engaged, check if we should engage the swipe
    if (!swipeEngaged.current) {
      const absDiffX = Math.abs(diffX);
      const absDiffY = Math.abs(diffY);

      // Engage swipe only if:
      // 1. Horizontal movement exceeds threshold
      // 2. Horizontal movement is greater than vertical (user is swiping, not scrolling)
      // 3. Movement is to the left (closing gesture)
      if (
        absDiffX > SWIPE_ENGAGE_THRESHOLD &&
        absDiffX > absDiffY &&
        diffX < 0
      ) {
        swipeEngaged.current = true;
      } else {
        return; // Not engaged yet, don't track offset
      }
    }

    // Only allow swiping left (negative offset)
    if (diffX < 0) {
      setSwipeOffset(diffX);
    }
  };

  const handleTouchEnd = () => {
    if (swipeEngaged.current && swipeOffset < -SWIPE_THRESHOLD) {
      onClose();
    }
    touchStartX.current = null;
    touchStartY.current = null;
    swipeEngaged.current = false;
    setSwipeOffset(0);
  };

  // Desktop sidebar resize handlers
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (!isDesktop || isCollapsed || !sidebarWidth) return;
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
    setIsResizing(true);
    onResizeStart?.();
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (resizeStartX.current === null || resizeStartWidth.current === null)
        return;
      const diff = e.clientX - resizeStartX.current;
      const newWidth = resizeStartWidth.current + diff;
      onResize?.(newWidth);
    };

    const handleMouseUp = () => {
      resizeStartX.current = null;
      resizeStartWidth.current = null;
      setIsResizing(false);
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, onResize, onResizeEnd]);

  // Handle switching hosts - disconnect and go to host picker
  const handleSwitchHost = () => {
    remoteConnection?.disconnect();
    navigate("/login");
    onNavigate();
  };

  // Starred sessions come from dedicated fetch (filtered by server)
  // Filter out archived just in case
  const filteredStarredSessions = useMemo(() => {
    return starredSessions.filter((s) => !s.isArchived);
  }, [starredSessions]);

  // Sessions updated in the last 24 hours (non-starred, non-archived)
  const recentDaySessions = useMemo(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const isWithinLastDay = (date: Date) => date.getTime() >= oneDayAgo;

    return globalSessions.filter(
      (s) =>
        !s.isStarred && !s.isArchived && isWithinLastDay(new Date(s.updatedAt)),
    );
  }, [globalSessions]);

  // Older sessions (non-starred, non-archived, NOT in last 24 hours)
  const olderSessions = useMemo(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const isOlderThanOneDay = (date: Date) => date.getTime() < oneDayAgo;

    return globalSessions.filter(
      (s) =>
        !s.isStarred &&
        !s.isArchived &&
        isOlderThanOneDay(new Date(s.updatedAt)),
    );
  }, [globalSessions]);

  // Track which sessions have unsent drafts in localStorage
  const drafts = useDrafts();

  // In desktop mode, always render. In mobile mode, only render when open.
  if (!isDesktop && !isOpen) return null;

  // Sidebar toggle icon for desktop mode
  const SidebarToggleIcon = () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );

  return (
    <>
      {/* Only show overlay in non-desktop mode */}
      {!isDesktop && (
        <div
          className="sidebar-overlay"
          onClick={onClose}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          role="button"
          tabIndex={0}
          aria-label={t("actionCloseSidebar")}
        />
      )}
      <aside
        ref={sidebarRef}
        className="sidebar"
        onTouchStart={!isDesktop ? handleTouchStart : undefined}
        onTouchMove={!isDesktop ? handleTouchMove : undefined}
        onTouchEnd={!isDesktop ? handleTouchEnd : undefined}
        style={
          !isDesktop && swipeOffset < 0
            ? { transform: `translateX(${swipeOffset}px)`, transition: "none" }
            : undefined
        }
      >
        <div className="sidebar-header">
          {isDesktop && isCollapsed ? (
            /* Desktop collapsed mode: show toggle button to expand */
            <button
              type="button"
              className="sidebar-toggle"
              onClick={onToggleExpanded}
              title={t("actionExpandSidebar")}
              aria-label={t("actionExpandSidebar")}
            >
              <SidebarToggleIcon />
            </button>
          ) : isDesktop ? (
            /* Desktop expanded mode: show brand (toggle is in toolbar) */
            <span className="sidebar-brand">
              <AgentLineLogo />
            </span>
          ) : (
            /* Mobile mode: brand text + close button */
            <>
              <span className="sidebar-brand">
                <AgentLineLogo />
              </span>
              <button
                type="button"
                className="sidebar-close"
                onClick={onClose}
                aria-label={t("actionCloseSidebar")}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </>
          )}
        </div>

        <div className="sidebar-actions">
          {/* New Session: link to most recent project's new session page */}
          <SidebarNavItem
            to={
              newSessionProjectId
                ? `/new-session?projectId=${encodeURIComponent(newSessionProjectId)}`
                : "/new-session"
            }
            icon={SidebarIcons.newSession}
            label={t("sidebarNewSession")}
            onClick={onNavigate}
            basePath={basePath}
          />
        </div>

        <div className="sidebar-sessions">
          {/* Navigation items that scroll with content */}
          <SidebarNavSection>
            <SidebarNavItem
              to="/inbox"
              icon={SidebarIcons.inbox}
              label={t("sidebarInbox")}
              badge={inboxCount}
              onClick={onNavigate}
              basePath={basePath}
            />
            <SidebarNavItem
              to="/sessions"
              icon={SidebarIcons.allSessions}
              label={t("sidebarAllSessions")}
              onClick={onNavigate}
              basePath={basePath}
            />
            <SidebarNavItem
              to="/projects"
              icon={SidebarIcons.projects}
              label={t("sidebarProjects")}
              onClick={onNavigate}
              basePath={basePath}
            />
            <SidebarNavItem
              to={
                newSessionProjectId
                  ? `/projects/${encodeURIComponent(newSessionProjectId)}/files`
                  : "/projects"
              }
              icon={SidebarIcons.files}
              label="Files"
              onClick={onNavigate}
              basePath={basePath}
            />
            <SidebarNavItem
              to="/voice-secretary"
              icon={SidebarIcons.voiceSecretary}
              label="Voice Secretary"
              onClick={onNavigate}
              basePath={basePath}
            />
            {capabilities.includes("git-status") && (
              <SidebarNavItem
                to="/git-status"
                icon={SidebarIcons.sourceControl}
                label={t("sidebarSourceControl")}
                onClick={onNavigate}
                basePath={basePath}
              />
            )}
            {(capabilities.includes("deviceBridge") ||
              capabilities.includes("deviceBridge-download")) && (
              <SidebarNavItem
                to="/devices"
                icon={SidebarIcons.emulator}
                label={t("sidebarDevices")}
                onClick={onNavigate}
                basePath={basePath}
              />
            )}
            <AgentsNavItem onClick={onNavigate} basePath={basePath} />
            <SidebarNavItem
              to="/settings"
              icon={SidebarIcons.settings}
              label={t("sidebarSettings")}
              onClick={onNavigate}
              basePath={basePath}
            />
            {/* Switch Host - show whenever we have a remote connection */}
            {remoteConnection && (
              <button
                type="button"
                className="sidebar-nav-item sidebar-switch-host"
                onClick={handleSwitchHost}
              >
                <span className="sidebar-nav-icon">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="17 1 21 5 17 9" />
                    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                    <polyline points="7 23 3 19 7 15" />
                    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                  </svg>
                </span>
                <span className="sidebar-nav-label">
                  {t("sidebarSwitchHost")}
                </span>
              </button>
            )}
          </SidebarNavSection>

          {/* Global sessions list */}
          {filteredStarredSessions.length > 0 && (
            <div className="sidebar-section">
              <h3 className="sidebar-section-title">
                {t("sidebarSectionStarred")}
              </h3>
              <ul className="sidebar-session-list">
                {filteredStarredSessions
                  .slice(0, starredSessionsLimit)
                  .map((session) => (
                    <SessionListItem
                      key={session.id}
                      sessionId={session.id}
                      projectId={session.projectId}
                      title={getSessionDisplayTitle(session)}
                      fullTitle={getSessionDisplayTitle(session)}
                      provider={session.provider}
                      status={session.ownership}
                      pendingInputType={session.pendingInputType}
                      hasUnread={session.hasUnread}
                      isStarred={session.isStarred}
                      isArchived={session.isArchived}
                      mode="compact"
                      isCurrent={session.id === currentSessionId}
                      activity={session.activity}
                      onNavigate={onNavigate}
                      showProjectName
                      projectName={session.projectName}
                      basePath={basePath}
                      messageCount={session.messageCount}
                      hasDraft={drafts.has(session.id)}
                    />
                  ))}
              </ul>
              {filteredStarredSessions.length > starredSessionsLimit && (
                <button
                  type="button"
                  className="sidebar-show-more"
                  onClick={() =>
                    setStarredSessionsLimit(
                      (prev) => prev + RECENT_SESSIONS_INCREMENT,
                    )
                  }
                >
                  {t("actionShowMore", {
                    count: Math.min(
                      RECENT_SESSIONS_INCREMENT,
                      filteredStarredSessions.length - starredSessionsLimit,
                    ),
                  })}
                </button>
              )}
            </div>
          )}

          {recentDaySessions.length > 0 && (
            <div className="sidebar-section">
              <h3 className="sidebar-section-title">
                {t("sidebarSectionLast24Hours")}
              </h3>
              <ul className="sidebar-session-list">
                {recentDaySessions
                  .slice(0, recentSessionsLimit)
                  .map((session) => (
                    <SessionListItem
                      key={session.id}
                      sessionId={session.id}
                      projectId={session.projectId}
                      title={getSessionDisplayTitle(session)}
                      fullTitle={getSessionDisplayTitle(session)}
                      provider={session.provider}
                      status={session.ownership}
                      pendingInputType={session.pendingInputType}
                      hasUnread={session.hasUnread}
                      isStarred={session.isStarred}
                      isArchived={session.isArchived}
                      mode="compact"
                      isCurrent={session.id === currentSessionId}
                      activity={session.activity}
                      onNavigate={onNavigate}
                      showProjectName
                      projectName={session.projectName}
                      basePath={basePath}
                      messageCount={session.messageCount}
                      hasDraft={drafts.has(session.id)}
                    />
                  ))}
              </ul>
              {recentDaySessions.length > recentSessionsLimit && (
                <button
                  type="button"
                  className="sidebar-show-more"
                  onClick={() =>
                    setRecentSessionsLimit(
                      (prev) => prev + RECENT_SESSIONS_INCREMENT,
                    )
                  }
                >
                  {t("actionShowMore", {
                    count: Math.min(
                      RECENT_SESSIONS_INCREMENT,
                      recentDaySessions.length - recentSessionsLimit,
                    ),
                  })}
                </button>
              )}
            </div>
          )}

          {olderSessions.length > 0 && (
            <div className="sidebar-section">
              <h3 className="sidebar-section-title">
                {t("sidebarSectionOlder")}
              </h3>
              <ul className="sidebar-session-list">
                {olderSessions.slice(0, olderSessionsLimit).map((session) => (
                  <SessionListItem
                    key={session.id}
                    sessionId={session.id}
                    projectId={session.projectId}
                    title={getSessionDisplayTitle(session)}
                    fullTitle={getSessionDisplayTitle(session)}
                    provider={session.provider}
                    status={session.ownership}
                    pendingInputType={session.pendingInputType}
                    hasUnread={session.hasUnread}
                    isStarred={session.isStarred}
                    isArchived={session.isArchived}
                    mode="compact"
                    isCurrent={session.id === currentSessionId}
                    activity={session.activity}
                    onNavigate={onNavigate}
                    showProjectName
                    projectName={session.projectName}
                    basePath={basePath}
                    messageCount={session.messageCount}
                    hasDraft={drafts.has(session.id)}
                  />
                ))}
              </ul>
              {olderSessions.length > olderSessionsLimit && (
                <button
                  type="button"
                  className="sidebar-show-more"
                  onClick={() =>
                    setOlderSessionsLimit(
                      (prev) => prev + RECENT_SESSIONS_INCREMENT,
                    )
                  }
                >
                  {t("actionShowMore", {
                    count: Math.min(
                      RECENT_SESSIONS_INCREMENT,
                      olderSessions.length - olderSessionsLimit,
                    ),
                  })}
                </button>
              )}
            </div>
          )}

          {filteredStarredSessions.length === 0 &&
            recentDaySessions.length === 0 &&
            olderSessions.length === 0 && (
              <p className="sidebar-empty">
                {sessionsLoading
                  ? t("sidebarLoadingSessions")
                  : t("sidebarNoSessions")}
              </p>
            )}
        </div>

        <div className="sidebar-account">
          <button
            type="button"
            className="sidebar-account-trigger"
            onClick={() => {
              setAccountError(null);
              void refreshAccountState();
              setAccountPanelOpen((current) =>
                requireAccessPasswordSetup ? true : !current,
              );
            }}
          >
            <span className="sidebar-account-avatar">
              {(accountEmail.trim()[0] ?? "U").toUpperCase()}
            </span>
            {!isCollapsed && (
              <span className="sidebar-account-meta">
                <span className="sidebar-account-name">
                  {accountInfo.user?.email ||
                    accountEmail.trim() ||
                    "Platform Account"}
                </span>
                <span className="sidebar-account-status">
                  {accountStatusLabel}
                </span>
              </span>
            )}
          </button>
        </div>

        {/* Resize handle - desktop only, when expanded */}
        {isDesktop && !isCollapsed && (
          <div
            className={`sidebar-resize-handle ${isResizing ? "active" : ""}`}
            onMouseDown={handleResizeMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("actionResizeSidebar")}
            tabIndex={0}
          />
        )}
      </aside>
      {accountPanelOpen && (
        <div
          className="sidebar-account-modal-overlay"
          onClick={(event) => {
            if (
              event.target === event.currentTarget &&
              !requireAccessPasswordSetup
            ) {
              setAccountPanelOpen(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !requireAccessPasswordSetup) {
              setAccountPanelOpen(false);
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Close account dialog"
        >
          <div className="sidebar-account-modal">
            <h3>
              {isAccountLoggedIn
                ? "用户信息"
                : accountMode === "login"
                  ? "登录"
                  : "注册"}
            </h3>
            {isAccountLoggedIn ? (
              <>
                {requireAccessPasswordSetup ? (
                  <>
                    <p className="sidebar-account-error">
                      为了确保手机端可连接，此账号登录后必须先设置访问密码。
                    </p>
                    <label className="sidebar-account-field">
                      <span>访问密码</span>
                      <input
                        type="password"
                        value={hostAccessPassword}
                        onChange={(event) =>
                          setHostAccessPassword(event.target.value)
                        }
                        disabled={accountBusy}
                        placeholder="至少 8 位"
                      />
                    </label>
                    <label className="sidebar-account-field">
                      <span>确认访问密码</span>
                      <input
                        type="password"
                        value={hostAccessPasswordConfirm}
                        onChange={(event) =>
                          setHostAccessPasswordConfirm(event.target.value)
                        }
                        disabled={accountBusy}
                        placeholder="再次输入访问密码"
                      />
                    </label>
                    <div className="sidebar-account-readonly">
                      <span>当前远程访问状态</span>
                      <span>
                        {hostAccessConfig?.hostAccessConfigured
                          ? "已配置"
                          : "未配置"}
                      </span>
                    </div>
                  </>
                ) : null}
                <div className="sidebar-account-readonly">
                  <span>ID</span>
                  <code>{accountInfo.user?.id}</code>
                </div>
                <div className="sidebar-account-readonly">
                  <span>创建时间</span>
                  <span>
                    {accountInfo.user?.createdAt
                      ? new Date(accountInfo.user.createdAt).toLocaleString()
                      : "-"}
                  </span>
                </div>
                <div className="sidebar-account-readonly">
                  <span>邮箱</span>
                  <span>{accountInfo.user?.email ?? "-"}</span>
                </div>
                {isDesktopManagedWithoutBridge ? (
                  <div className="sidebar-account-readonly">
                    <span>账号管理</span>
                    <span>请在 AgentLine 桌面窗口中退出登录或编辑资料。</span>
                  </div>
                ) : null}
                {accountProfileEditing && (
                  <>
                    <label className="sidebar-account-field">
                      <span>邮箱</span>
                      <input
                        value={accountProfileEmail}
                        onChange={(event) =>
                          setAccountProfileEmail(event.target.value)
                        }
                        disabled={accountBusy}
                        placeholder="you@example.com"
                      />
                    </label>
                    <label className="sidebar-account-field">
                      <span>当前密码（用于确认）</span>
                      <input
                        type="password"
                        value={accountCurrentPassword}
                        onChange={(event) =>
                          setAccountCurrentPassword(event.target.value)
                        }
                        disabled={accountBusy}
                        placeholder="请输入当前密码"
                      />
                    </label>
                    <label className="sidebar-account-field">
                      <span>新密码（可选）</span>
                      <input
                        type="password"
                        value={accountNewPassword}
                        onChange={(event) =>
                          setAccountNewPassword(event.target.value)
                        }
                        disabled={accountBusy}
                        placeholder="不修改请留空"
                      />
                    </label>
                    <label className="sidebar-account-field">
                      <span>确认新密码</span>
                      <input
                        type="password"
                        value={accountConfirmNewPassword}
                        onChange={(event) =>
                          setAccountConfirmNewPassword(event.target.value)
                        }
                        disabled={accountBusy}
                        placeholder="不修改请留空"
                      />
                    </label>
                  </>
                )}
              </>
            ) : (
              <>
                <label className="sidebar-account-field">
                  <span>邮箱</span>
                  <input
                    value={accountEmail}
                    onChange={(event) => setAccountEmail(event.target.value)}
                    disabled={accountBusy}
                    placeholder="you@example.com"
                  />
                </label>
                <label className="sidebar-account-field">
                  <span>密码</span>
                  <input
                    type="password"
                    value={accountPassword}
                    onChange={(event) => setAccountPassword(event.target.value)}
                    disabled={accountBusy}
                    placeholder="请输入密码"
                  />
                </label>
              </>
            )}
            {!isAccountLoggedIn && accountMode === "register" && (
              <label className="sidebar-account-field">
                <span>确认密码</span>
                <input
                  type="password"
                  value={accountConfirmPassword}
                  onChange={(event) =>
                    setAccountConfirmPassword(event.target.value)
                  }
                  disabled={accountBusy}
                  placeholder="请再次输入密码"
                />
              </label>
            )}
            {accountError ? (
              <p className="sidebar-account-error">{accountError}</p>
            ) : null}
            <div className="sidebar-account-actions">
              {isAccountLoggedIn ? (
                <>
                  {requireAccessPasswordSetup ? (
                    <>
                      <button
                        type="button"
                        className="sidebar-account-primary"
                        disabled={accountBusy}
                        onClick={configureHostAccessPassword}
                      >
                        {accountBusy ? "处理中..." : "设置访问密码"}
                      </button>
                      <button
                        type="button"
                        className="sidebar-account-secondary"
                        disabled={accountBusy || isDesktopManagedWithoutBridge}
                        onClick={handleAccountLogout}
                      >
                        退出登录
                      </button>
                    </>
                  ) : isDesktopManagedWithoutBridge ? (
                    <button
                      type="button"
                      className="sidebar-account-secondary"
                      disabled
                    >
                      请在桌面窗口管理账号
                    </button>
                  ) : accountProfileEditing ? (
                    <>
                      <button
                        type="button"
                        className="sidebar-account-primary"
                        disabled={accountBusy}
                        onClick={handleAccountProfileSave}
                      >
                        {accountBusy ? "处理中..." : "保存修改"}
                      </button>
                      <button
                        type="button"
                        className="sidebar-account-secondary"
                        disabled={accountBusy}
                        onClick={() => {
                          setAccountProfileEditing(false);
                          setAccountError(null);
                          setAccountCurrentPassword("");
                          setAccountNewPassword("");
                          setAccountConfirmNewPassword("");
                          setAccountProfileEmail(accountInfo.user?.email ?? "");
                        }}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="sidebar-account-secondary"
                        disabled={accountBusy}
                        onClick={() => {
                          setAccountProfileEditing(true);
                          setAccountError(null);
                          setAccountProfileEmail(accountInfo.user?.email ?? "");
                        }}
                      >
                        编辑资料
                      </button>
                      <button
                        type="button"
                        className="sidebar-account-secondary"
                        disabled={accountBusy}
                        onClick={handleAccountLogout}
                      >
                        退出登录
                      </button>
                    </>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="sidebar-account-primary"
                  disabled={accountBusy}
                  onClick={handleAccountAuthSubmit}
                >
                  {accountBusy
                    ? "处理中..."
                    : accountMode === "login"
                      ? "登录"
                      : "注册并登录"}
                </button>
              )}
            </div>
            {!isAccountLoggedIn && (
              <p className="sidebar-account-switch">
                {accountMode === "login" ? "还没有账号？" : "已有账号？"}
                <button
                  type="button"
                  onClick={() => {
                    resetAccountFormState();
                    setAccountMode((current) =>
                      current === "login" ? "register" : "login",
                    );
                  }}
                  disabled={accountBusy}
                >
                  {accountMode === "login" ? "去注册" : "去登录"}
                </button>
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
