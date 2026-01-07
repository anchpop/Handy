import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { commands, type TranscriptionProviderConfig, type CloudProviderType } from "@/bindings";
import { Dropdown } from "../ui/Dropdown";
import { Input } from "../ui/Input";
import { SettingContainer } from "../ui/SettingContainer";

// Helper to create display names for cloud providers
const getCloudProviderLabel = (provider: CloudProviderType): string => {
  switch (provider) {
    case "openai":
      return "OpenAI Whisper API";
    case "groq":
      return "Groq Whisper API";
    case "custom":
      return "Custom API";
  }
};

// Default values for new cloud configs
const getDefaultCloudConfig = (provider: CloudProviderType) => {
  const baseUrls: Record<CloudProviderType, string> = {
    openai: "https://api.openai.com/v1",
    groq: "https://api.groq.com/openai/v1",
    custom: "http://localhost:8080/v1",
  };
  const models: Record<CloudProviderType, string> = {
    openai: "whisper-1",
    groq: "whisper-large-v3",
    custom: "whisper-1",
  };
  return {
    provider,
    api_key: "",
    base_url: baseUrls[provider],
    model: models[provider],
  };
};

type ProviderType = "local" | CloudProviderType;

export const TranscriptionProviderSettings: React.FC = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<TranscriptionProviderConfig | null>(null);
  const [cloudProviderTypes, setCloudProviderTypes] = useState<CloudProviderType[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);

  // Local form state for cloud provider fields
  const [localApiKey, setLocalApiKey] = useState("");
  const [localModel, setLocalModel] = useState("");
  const [localBaseUrl, setLocalBaseUrl] = useState("");

  // Load config on mount
  useEffect(() => {
    const load = async () => {
      const [configResult, cloudTypes] = await Promise.all([
        commands.getTranscriptionConfig(),
        commands.getCloudProviderTypes(),
      ]);
      if (configResult.status === "ok") {
        setConfig(configResult.data);
        // Sync local state
        if (configResult.data.type === "CloudProvider") {
          setLocalApiKey(configResult.data.api_key);
          setLocalModel(configResult.data.model);
          setLocalBaseUrl(configResult.data.base_url);
        }
      }
      // getCloudProviderTypes returns array directly, not Result
      setCloudProviderTypes(cloudTypes);
    };
    load();
  }, []);

  const isLocal = config?.type === "LocalProvider";
  const isCloud = config?.type === "CloudProvider";

  // Get current provider type for dropdown
  const getCurrentProviderType = (): ProviderType => {
    if (!config || config.type === "LocalProvider") return "local";
    return config.provider;
  };

  // Build provider options for dropdown
  const providerOptions = [
    { value: "local" as ProviderType, label: t("settings.transcription.provider.local", "Local Model") },
    ...cloudProviderTypes.map((p) => ({
      value: p as ProviderType,
      label: getCloudProviderLabel(p),
    })),
  ];

  // Handle provider type change
  const handleProviderChange = async (value: string) => {
    const providerType = value as ProviderType;
    if (!providerType) return;
    setIsUpdating(true);

    let newConfig: TranscriptionProviderConfig;
    if (providerType === "local") {
      newConfig = { type: "LocalProvider", model_id: "" };
    } else {
      const cloudConfig = getDefaultCloudConfig(providerType);
      newConfig = { type: "CloudProvider", ...cloudConfig };
      // Update local form state
      setLocalApiKey(cloudConfig.api_key);
      setLocalModel(cloudConfig.model);
      setLocalBaseUrl(cloudConfig.base_url);
    }

    const result = await commands.setTranscriptionConfig(newConfig);
    if (result.status === "ok") {
      setConfig(newConfig);
    }
    setIsUpdating(false);
  };

  // Save current cloud config
  const saveCloudConfig = async () => {
    if (!config || config.type !== "CloudProvider") return;
    setIsUpdating(true);

    const newConfig: TranscriptionProviderConfig = {
      type: "CloudProvider",
      provider: config.provider,
      api_key: localApiKey,
      base_url: localBaseUrl,
      model: localModel,
    };

    const result = await commands.setTranscriptionConfig(newConfig);
    if (result.status === "ok") {
      setConfig(newConfig);
    }
    setIsUpdating(false);
  };

  const handleApiKeyBlur = () => saveCloudConfig();
  const handleModelBlur = () => saveCloudConfig();
  const handleBaseUrlBlur = () => saveCloudConfig();

  const allowBaseUrlEdit = isCloud && config?.provider === "custom";

  return (
    <>
      {/* Provider Selector */}
      <SettingContainer
        title={t("settings.transcription.provider.title")}
        description={t("settings.transcription.provider.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <Dropdown
          selectedValue={getCurrentProviderType()}
          options={providerOptions}
          onSelect={handleProviderChange}
          disabled={isUpdating}
          className="min-w-[200px]"
        />
      </SettingContainer>

      {/* API Settings (only shown for cloud providers) */}
      {isCloud && (
        <>
          {/* Base URL (only for custom provider) */}
          {allowBaseUrlEdit && (
            <SettingContainer
              title={t("settings.transcription.baseUrl.title")}
              description={t("settings.transcription.baseUrl.description")}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped={true}
            >
              <Input
                type="text"
                value={localBaseUrl}
                onChange={(e) => setLocalBaseUrl(e.target.value)}
                onBlur={handleBaseUrlBlur}
                placeholder="https://api.example.com/v1"
                disabled={isUpdating}
                className="min-w-[300px]"
                variant="compact"
              />
            </SettingContainer>
          )}

          {/* API Key */}
          <SettingContainer
            title={t("settings.transcription.apiKey.title")}
            description={t("settings.transcription.apiKey.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped={true}
          >
            <Input
              type="password"
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
              onBlur={handleApiKeyBlur}
              placeholder={t("settings.transcription.apiKey.placeholder")}
              disabled={isUpdating}
              className="min-w-[300px]"
              variant="compact"
            />
          </SettingContainer>

          {/* Model */}
          <SettingContainer
            title={t("settings.transcription.apiModel.title")}
            description={t("settings.transcription.apiModel.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped={true}
          >
            <Input
              type="text"
              value={localModel}
              onChange={(e) => setLocalModel(e.target.value)}
              onBlur={handleModelBlur}
              placeholder="whisper-1"
              disabled={isUpdating}
              className="min-w-[200px]"
              variant="compact"
            />
          </SettingContainer>
        </>
      )}
    </>
  );
};
