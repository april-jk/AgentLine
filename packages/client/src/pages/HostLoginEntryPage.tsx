import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AgentLineLogo } from "../components/AgentLineLogo";
import { useRemoteConnection } from "../contexts/RemoteConnectionContext";
import { useI18n } from "../i18n";
import { loadSavedAccount } from "./hostPickerShared";

function hasRelayHashCredentials(): boolean {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return false;
  try {
    const params = new URLSearchParams(hash.slice(1));
    return Boolean(params.get("u") && params.get("p"));
  } catch {
    return false;
  }
}

export function HostLoginEntryPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { isAutoResuming } = useRemoteConnection();

  useEffect(() => {
    if (hasRelayHashCredentials()) {
      navigate(
        {
          pathname: "/login/devices",
          hash: window.location.hash,
        },
        { replace: true },
      );
      return;
    }

    const saved = loadSavedAccount();
    if (saved) {
      navigate("/login/devices", { replace: true });
    }
  }, [navigate]);

  if (isAutoResuming) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-logo">
            <AgentLineLogo />
          </div>
          <p className="login-subtitle">{t("reconnecting")}</p>
          <div className="login-loading" data-testid="auto-resume-loading">
            <div className="login-spinner" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container login-container-unified host-picker-shell host-entry-shell">
        <div className="host-entry-top">
          <div className="login-logo host-picker-logo host-entry-logo">
            <AgentLineLogo />
          </div>
          <h1 className="host-entry-title">选择连接方式</h1>
          <p className="host-entry-subtitle">
            先完成认证，再进入设备列表进行连接。
          </p>
        </div>

        <section className="host-picker-panel host-entry-panel">
          <div className="host-entry-mode-list">
            <button
              type="button"
              className="host-entry-mode-card host-entry-mode-card-primary"
              onClick={() =>
                navigate("/login/account", {
                  state: { fromEntry: true },
                })
              }
              data-testid="entry-platform-account"
            >
              <span className="host-entry-mode-badge">推荐</span>
              <span className="host-entry-mode-title">平台账号登录</span>
              <span className="host-entry-mode-desc">
                使用 平台账号登录，进入可控设备列表。
              </span>
            </button>
            <button
              type="button"
              className="host-entry-mode-card host-entry-mode-card-secondary"
              onClick={() => navigate("/login/direct")}
              data-testid="entry-lan-login"
            >
              <span className="host-entry-mode-title">局域网登录</span>
              <span className="host-entry-mode-desc">
                适用于同一网络下的直连调试和本地访问。
              </span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
