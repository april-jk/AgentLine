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
      <div className="login-container login-container-unified host-picker-shell">
        <div className="host-picker-top">
          <div className="login-logo host-picker-logo">
            <AgentLineLogo />
          </div>
          <p className="login-subtitle host-picker-top-subtitle">
            Choose connection mode
          </p>
        </div>

        <section className="host-picker-panel">
          <div className="host-picker-list">
            <button
              type="button"
              className="login-button host-picker-add-button"
              onClick={() => navigate("/login/account")}
              data-testid="entry-platform-account"
            >
              Platform Account Login
            </button>
            <button
              type="button"
              className="login-button host-picker-add-button"
              onClick={() => navigate("/login/direct")}
              data-testid="entry-lan-login"
            >
              LAN Login
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
