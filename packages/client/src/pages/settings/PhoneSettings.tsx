import { useCallback, useEffect, useState } from "react";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";

const MAX_SHORT_VALUE = 200;
const MAX_SECRET_VALUE = 5000;
const MAX_URL_VALUE = 2000;

export function PhoneSettings() {
  const { t } = useI18n();
  const { settings, isLoading, error, updateSetting } = useServerSettings();
  const [asrAppId, setAsrAppId] = useState("");
  const [asrAccessToken, setAsrAccessToken] = useState("");
  const [asrSecretKey, setAsrSecretKey] = useState("");
  const [ttsAppId, setTtsAppId] = useState("");
  const [ttsAccessToken, setTtsAccessToken] = useState("");
  const [ttsSecretKey, setTtsSecretKey] = useState("");
  const [ttsVoiceType, setTtsVoiceType] = useState("");
  const [asrEndpoint, setAsrEndpoint] = useState("");
  const [ttsEndpoint, setTtsEndpoint] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setAsrAppId(settings.phoneVolcengineAsrAppId ?? "");
    setAsrAccessToken(settings.phoneVolcengineAsrAccessToken ?? "");
    setAsrSecretKey(settings.phoneVolcengineAsrSecretKey ?? "");
    setTtsAppId(
      settings.phoneVolcengineTtsAppId ??
        settings.phoneVolcengineSpeechAppId ??
        "",
    );
    setTtsAccessToken(
      settings.phoneVolcengineTtsAccessToken ??
        settings.phoneVolcengineSpeechAccessToken ??
        "",
    );
    setTtsSecretKey(
      settings.phoneVolcengineTtsSecretKey ??
        settings.phoneVolcengineSpeechSecretKey ??
        "",
    );
    setTtsVoiceType(settings.phoneVolcengineTtsVoiceType ?? "");
    setAsrEndpoint(settings.phoneVolcengineAsrEndpoint ?? "");
    setTtsEndpoint(settings.phoneVolcengineTtsEndpoint ?? "");
    setHasChanges(false);
  }, [settings]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await Promise.all([
        updateSetting(
          "phoneVolcengineAsrAppId",
          asrAppId.trim() || undefined,
        ),
        updateSetting(
          "phoneVolcengineAsrAccessToken",
          asrAccessToken.trim() || undefined,
        ),
        updateSetting(
          "phoneVolcengineAsrSecretKey",
          asrSecretKey.trim() || undefined,
        ),
        updateSetting(
          "phoneVolcengineTtsAppId",
          ttsAppId.trim() || undefined,
        ),
        updateSetting(
          "phoneVolcengineTtsAccessToken",
          ttsAccessToken.trim() || undefined,
        ),
        updateSetting(
          "phoneVolcengineTtsSecretKey",
          ttsSecretKey.trim() || undefined,
        ),
        updateSetting(
          "phoneVolcengineTtsVoiceType",
          ttsVoiceType.trim() || undefined,
        ),
        updateSetting(
          "phoneVolcengineAsrEndpoint",
          asrEndpoint.trim() || undefined,
        ),
        updateSetting(
          "phoneVolcengineTtsEndpoint",
          ttsEndpoint.trim() || undefined,
        ),
      ]);
      setHasChanges(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t("phoneSettingsSaveFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    asrAccessToken,
    asrAppId,
    asrEndpoint,
    asrSecretKey,
    t,
    ttsAccessToken,
    ttsAppId,
    ttsEndpoint,
    ttsSecretKey,
    ttsVoiceType,
    updateSetting,
  ]);

  if (isLoading) {
    return (
      <section className="settings-section">
        <h2>{t("phoneSettingsTitle")}</h2>
        <p className="settings-section-description">
          {t("phoneSettingsLoading")}
        </p>
      </section>
    );
  }

  const asrConfigured = Boolean(asrAppId && asrAccessToken && asrSecretKey);
  const ttsConfigured = Boolean(
    ttsAppId && ttsAccessToken && ttsSecretKey && ttsVoiceType,
  );
  const configured = asrConfigured && ttsConfigured;

  return (
    <section className="settings-section">
      <h2>{t("phoneSettingsTitle")}</h2>
      <p className="settings-section-description">
        {t("phoneSettingsDescription")}
      </p>

      <div className="settings-group">
        <h3 className="settings-subsection-title">
          {t("phoneSettingsAsrCredentialsTitle")}
        </h3>
        <div className="settings-item settings-item-stacked">
          <div className="settings-item-info">
            <strong>{t("phoneSettingsAppIdTitle")}</strong>
            <p>{t("phoneSettingsAsrAppIdDescription")}</p>
          </div>
          <input
            type="text"
            className="settings-input"
            value={asrAppId}
            onChange={(event) => {
              setAsrAppId(event.target.value.slice(0, MAX_SHORT_VALUE));
              setHasChanges(true);
              setSaveError(null);
            }}
            placeholder="asr-app-id"
          />
        </div>

        <div className="settings-item settings-item-stacked">
          <div className="settings-item-info">
            <strong>{t("phoneSettingsAccessTokenTitle")}</strong>
            <p>{t("phoneSettingsAsrAccessTokenDescription")}</p>
          </div>
          <input
            type="password"
            className="settings-input"
            value={asrAccessToken}
            onChange={(event) => {
              setAsrAccessToken(
                event.target.value.slice(0, MAX_SECRET_VALUE),
              );
              setHasChanges(true);
              setSaveError(null);
            }}
            placeholder="asr access token / api key"
          />
        </div>

        <div className="settings-item settings-item-stacked">
          <div className="settings-item-info">
            <strong>{t("phoneSettingsSecretKeyTitle")}</strong>
            <p>{t("phoneSettingsAsrSecretKeyDescription")}</p>
          </div>
          <input
            type="password"
            className="settings-input"
            value={asrSecretKey}
            onChange={(event) => {
              setAsrSecretKey(event.target.value.slice(0, MAX_SECRET_VALUE));
              setHasChanges(true);
              setSaveError(null);
            }}
            placeholder="asr secret key"
          />
        </div>

        <h3 className="settings-subsection-title">
          {t("phoneSettingsTtsCredentialsTitle")}
        </h3>

        <div className="settings-item settings-item-stacked">
          <div className="settings-item-info">
            <strong>{t("phoneSettingsAppIdTitle")}</strong>
            <p>{t("phoneSettingsTtsAppIdDescription")}</p>
          </div>
          <input
            type="text"
            className="settings-input"
            value={ttsAppId}
            onChange={(event) => {
              setTtsAppId(event.target.value.slice(0, MAX_SHORT_VALUE));
              setHasChanges(true);
              setSaveError(null);
            }}
            placeholder="tts-app-id"
          />
        </div>

        <div className="settings-item settings-item-stacked">
          <div className="settings-item-info">
            <strong>{t("phoneSettingsAccessTokenTitle")}</strong>
            <p>{t("phoneSettingsTtsAccessTokenDescription")}</p>
          </div>
          <input
            type="password"
            className="settings-input"
            value={ttsAccessToken}
            onChange={(event) => {
              setTtsAccessToken(
                event.target.value.slice(0, MAX_SECRET_VALUE),
              );
              setHasChanges(true);
              setSaveError(null);
            }}
            placeholder="tts access token / api key"
          />
        </div>

        <div className="settings-item settings-item-stacked">
          <div className="settings-item-info">
            <strong>{t("phoneSettingsSecretKeyTitle")}</strong>
            <p>{t("phoneSettingsTtsSecretKeyDescription")}</p>
          </div>
          <input
            type="password"
            className="settings-input"
            value={ttsSecretKey}
            onChange={(event) => {
              setTtsSecretKey(event.target.value.slice(0, MAX_SECRET_VALUE));
              setHasChanges(true);
              setSaveError(null);
            }}
            placeholder="tts secret key"
          />
        </div>

        <div className="settings-item settings-item-stacked">
          <div className="settings-item-info">
            <strong>{t("phoneSettingsVoiceTypeTitle")}</strong>
            <p>{t("phoneSettingsVoiceTypeDescription")}</p>
          </div>
          <input
            type="text"
            className="settings-input"
            value={ttsVoiceType}
            onChange={(event) => {
              setTtsVoiceType(event.target.value.slice(0, MAX_SHORT_VALUE));
              setHasChanges(true);
              setSaveError(null);
            }}
            placeholder="voice type"
          />
        </div>

        <div className="settings-phone-grid">
          <div className="settings-item settings-item-stacked">
            <div className="settings-item-info">
              <strong>{t("phoneSettingsAsrEndpointTitle")}</strong>
              <p>{t("phoneSettingsEndpointDescription")}</p>
            </div>
            <input
              type="url"
              className="settings-input"
              value={asrEndpoint}
              onChange={(event) => {
                setAsrEndpoint(event.target.value.slice(0, MAX_URL_VALUE));
                setHasChanges(true);
                setSaveError(null);
              }}
              placeholder="wss://..."
            />
          </div>

          <div className="settings-item settings-item-stacked">
            <div className="settings-item-info">
              <strong>{t("phoneSettingsTtsEndpointTitle")}</strong>
              <p>{t("phoneSettingsEndpointDescription")}</p>
            </div>
            <input
              type="url"
              className="settings-input"
              value={ttsEndpoint}
              onChange={(event) => {
                setTtsEndpoint(event.target.value.slice(0, MAX_URL_VALUE));
                setHasChanges(true);
                setSaveError(null);
              }}
              placeholder="wss://..."
            />
          </div>
        </div>

        <div className="settings-actions-row">
          <button
            type="button"
            className="settings-button"
            disabled={!hasChanges || isSaving}
            onClick={handleSave}
          >
            {isSaving ? t("phoneSettingsSaving") : t("phoneSettingsSave")}
          </button>
          <span className={configured ? "settings-success" : "settings-hint"}>
            {configured
              ? t("phoneSettingsConfigured")
              : t("phoneSettingsNotConfigured")}
          </span>
        </div>

        {(error || saveError) && (
          <p className="settings-error">{saveError ?? error}</p>
        )}
      </div>
    </section>
  );
}
