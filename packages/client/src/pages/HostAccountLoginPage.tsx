import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentLineLogo } from "../components/AgentLineLogo";
import { useRemoteConnection } from "../contexts/RemoteConnectionContext";
import { useI18n } from "../i18n";
import {
  type AccountMode,
  DEFAULT_CONTROL_PLANE_URL,
  authenticateAccount,
  loadSavedAccount,
  saveAccount,
} from "./hostPickerShared";

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

export function HostAccountLoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { isAutoResuming } = useRemoteConnection();

  const [accountMode, setAccountMode] = useState<AccountMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadSavedAccount();
    if (saved) {
      navigate("/login/devices", { replace: true });
      return;
    }
    if (hasRelayHashCredentials()) {
      navigate(
        {
          pathname: "/login/devices",
          hash: window.location.hash,
        },
        { replace: true },
      );
    }
  }, [navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await authenticateAccount(
        DEFAULT_CONTROL_PLANE_URL,
        accountMode,
        email.trim(),
        password,
      );
      saveAccount({
        controlPlaneUrl: DEFAULT_CONTROL_PLANE_URL,
        accessToken: result.accessToken,
        email: email.trim(),
      });
      setPassword("");
      navigate("/login/devices", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

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
            Platform account sign-in
          </p>
        </div>

        {error ? (
          <div className="login-error" data-testid="host-picker-error">
            {error}
          </div>
        ) : null}

        <section className="host-picker-panel">
          <form onSubmit={handleAuth} className="login-form">
            <div className="host-picker-mode-switch">
              <button
                type="button"
                className={`host-picker-mode-tab ${accountMode === "login" ? "host-picker-mode-tab-active" : ""}`}
                onClick={() => setAccountMode("login")}
                disabled={loading}
              >
                Login
              </button>
              <button
                type="button"
                className={`host-picker-mode-tab ${accountMode === "register" ? "host-picker-mode-tab-active" : ""}`}
                onClick={() => setAccountMode("register")}
                disabled={loading}
              >
                Register
              </button>
            </div>
            <div className="login-field">
              <label htmlFor="accountEmail">Email</label>
              <input
                id="accountEmail"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="you@example.com"
                disabled={loading}
              />
            </div>
            <div className="login-field">
              <label htmlFor="accountPassword">Password</label>
              <input
                id="accountPassword"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  accountMode === "register"
                    ? "new-password"
                    : "current-password"
                }
                placeholder="your account password"
                disabled={loading}
              />
            </div>
            <button type="submit" className="login-button" disabled={loading}>
              {loading
                ? "Submitting..."
                : accountMode === "register"
                  ? "Register & Login"
                  : "Login"}
            </button>
            <button
              type="button"
              className="login-advanced-toggle"
              onClick={() => navigate("/login")}
              disabled={loading}
            >
              Back
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
