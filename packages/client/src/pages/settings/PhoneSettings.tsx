import { ALL_PROVIDERS, type ProviderName } from "@agentline/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EFFORT_LEVEL_OPTIONS } from "../../hooks/useModelSettings";
import { useProviders } from "../../hooks/useProviders";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";

const MAX_SHORT_VALUE = 200;
const MAX_SECRET_VALUE = 5000;
const MAX_URL_VALUE = 2000;
const TALKER_MODEL_LIST_ID = "phone-talker-models";

export function PhoneSettings() {
  const { t } = useI18n();
  const { settings, isLoading, error, updateSetting } = useServerSettings();
  const { providers } = useProviders();
  const [asrAppId, setAsrAppId] = useState("");
  const [asrAccessToken, setAsrAccessToken] = useState("");
  const [asrSecretKey, setAsrSecretKey] = useState("");
  const [ttsAppId, setTtsAppId] = useState("");
  const [ttsAccessToken, setTtsAccessToken] = useState("");
  const [ttsSecretKey, setTtsSecretKey] = useState("");
  const [ttsVoiceType, setTtsVoiceType] = useState("");
  const [asrEndpoint, setAsrEndpoint] = useState("");
  const [ttsEndpoint, setTtsEndpoint] = useState("");
  const [talkerProvider, setTalkerProvider] = useState<ProviderName>("codex");
  const [talkerModel, setTalkerModel] = useState("gpt-5.2");
  const [talkerEffort, setTalkerEffort] =
    useState<(typeof EFFORT_LEVEL_OPTIONS)[number]["value"]>("low");
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const providerOptions = useMemo(() => {
    const providerMap = new Map(
      providers.map((provider) => [provider.name, provider]),
    );
    return ALL_PROVIDERS.map((providerName) => {
      const provider = providerMap.get(providerName);
      return {
        name: providerName,
        label: provider?.displayName ?? providerName,
        models: provider?.models ?? [],
      };
    });
  }, [providers]);

  const selectedTalkerProvider = providerOptions.find(
    (provider) => provider.name === talkerProvider,
  );

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
    setTalkerProvider(settings.phoneTalkerProvider ?? "codex");
    setTalkerModel(settings.phoneTalkerModel ?? "gpt-5.2");
    setTalkerEffort(settings.phoneTalkerEffort ?? "low");
    setHasChanges(false);
  }, [settings]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await Promise.all([
        updateSetting("phoneVolcengineAsrAppId", asrAppId.trim() || undefined),
        updateSetting(
          "phoneVolcengineAsrAccessToken",
          asrAccessToken.trim() || undefined,
        ),
        updateSetting(
          "phoneVolcengineAsrSecretKey",
          asrSecretKey.trim() || undefined,
        ),
        updateSetting("phoneVolcengineTtsAppId", ttsAppId.trim() || undefined),
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
        updateSetting("phoneTalkerProvider", talkerProvider),
        updateSetting("phoneTalkerModel", talkerModel.trim() || undefined),
        updateSetting("phoneTalkerEffort", talkerEffort),
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
    talkerEffort,
    talkerModel,
    talkerProvider,
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
              setAsrAccessToken(event.target.value.slice(0, MAX_SECRET_VALUE));
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
              setTtsAccessToken(event.target.value.slice(0, MAX_SECRET_VALUE));
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

        <h3 className="settings-subsection-title">
          {t("phoneSettingsTalkerTitle")}
        </h3>
        <p className="settings-section-description">
          {t("phoneSettingsTalkerDescription")}
        </p>

        <div className="settings-item settings-item-stacked">
          <div className="settings-item-info">
            <strong>{t("phoneSettingsTalkerProviderTitle")}</strong>
            <p>{t("phoneSettingsTalkerProviderDescription")}</p>
          </div>
          <select
            className="settings-select"
            value={talkerProvider}
            onChange={(event) => {
              setTalkerProvider(event.target.value as ProviderName);
              setHasChanges(true);
              setSaveError(null);
            }}
          >
            {providerOptions.map((provider) => (
              <option key={provider.name} value={provider.name}>
                {provider.label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-item settings-item-stacked">
          <div className="settings-item-info">
            <strong>{t("phoneSettingsTalkerModelTitle")}</strong>
            <p>{t("phoneSettingsTalkerModelDescription")}</p>
          </div>
          <input
            type="text"
            className="settings-input"
            value={talkerModel}
            onChange={(event) => {
              setTalkerModel(event.target.value.slice(0, MAX_SHORT_VALUE));
              setHasChanges(true);
              setSaveError(null);
            }}
            placeholder="gpt-5.2"
            list={TALKER_MODEL_LIST_ID}
          />
          <datalist id={TALKER_MODEL_LIST_ID}>
            {(selectedTalkerProvider?.models ?? []).map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </datalist>
        </div>

        <div className="settings-item settings-item-stacked">
          <div className="settings-item-info">
            <strong>{t("phoneSettingsTalkerEffortTitle")}</strong>
            <p>{t("phoneSettingsTalkerEffortDescription")}</p>
          </div>
          <select
            className="settings-select"
            value={talkerEffort}
            onChange={(event) => {
              setTalkerEffort(
                event.target
                  .value as (typeof EFFORT_LEVEL_OPTIONS)[number]["value"],
              );
              setHasChanges(true);
              setSaveError(null);
            }}
          >
            {EFFORT_LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
