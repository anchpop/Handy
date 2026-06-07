import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands, type ModelInfo, type CloudProviderType } from "@/bindings";
import type { ModelCardStatus } from "./ModelCard";
import ModelCard from "./ModelCard";
import HandyTextLogo from "../icons/HandyTextLogo";
import { useModelStore } from "../../stores/modelStore";
import { Cloud, HardDrive, ChevronDown, Zap } from "lucide-react";
import { Input } from "../ui/Input";

interface OnboardingProps {
  onModelSelected: () => void;
}

type ExpandedSection = "local" | "cloud" | null;

// Cloud provider configuration
const cloudProviders: {
  id: CloudProviderType;
  name: string;
  description: string;
  baseUrl: string;
  defaultModel: string;
}[] = [
  {
    id: "groq",
    name: "Groq",
    description: "Fast & free tier available",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "whisper-large-v3",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Official Whisper API",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "whisper-1",
  },
  {
    id: "custom",
    name: "Custom",
    description: "Self-hosted or other provider",
    baseUrl: "http://localhost:8080/v1",
    defaultModel: "whisper-1",
  },
];

const Onboarding: React.FC<OnboardingProps> = ({ onModelSelected }) => {
  const { t } = useTranslation();
  const {
    models,
    downloadModel,
    selectModel,
    downloadingModels,
    verifyingModels,
    extractingModels,
    downloadProgress,
    downloadStats,
  } = useModelStore();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] =
    useState<ExpandedSection>("local");

  // Cloud provider state
  const [selectedCloudProvider, setSelectedCloudProvider] =
    useState<CloudProviderType | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState(
    "http://localhost:8080/v1",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDownloading = selectedModelId !== null;

  // Watch for the selected model to finish downloading + verifying + extracting
  useEffect(() => {
    if (!selectedModelId) return;

    const model = models.find((m) => m.id === selectedModelId);
    const stillDownloading = selectedModelId in downloadingModels;
    const stillVerifying = selectedModelId in verifyingModels;
    const stillExtracting = selectedModelId in extractingModels;

    if (
      model?.is_downloaded &&
      !stillDownloading &&
      !stillVerifying &&
      !stillExtracting
    ) {
      // Model is ready — select it and transition
      selectModel(selectedModelId).then((success) => {
        if (success) {
          onModelSelected();
        } else {
          toast.error(t("onboarding.errors.selectModel"));
          setSelectedModelId(null);
        }
      });
    }
  }, [
    selectedModelId,
    models,
    downloadingModels,
    verifyingModels,
    extractingModels,
    selectModel,
    onModelSelected,
  ]);

  const handleDownloadModel = async (modelId: string) => {
    setSelectedModelId(modelId);

    // Error toast is handled centrally by the model-download-failed event listener
    // in modelStore — no toast here to avoid duplicates.
    const success = await downloadModel(modelId);
    if (!success) {
      setSelectedModelId(null);
    }
  };

  const handleCloudProviderSelect = (providerId: CloudProviderType) => {
    setSelectedCloudProvider(providerId);
    setApiKey("");
    if (providerId === "custom") {
      setCustomBaseUrl("http://localhost:8080/v1");
    }
  };

  const handleCloudSubmit = async () => {
    if (!selectedCloudProvider) return;

    const provider = cloudProviders.find((p) => p.id === selectedCloudProvider);
    if (!provider) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await commands.setTranscriptionConfig({
        type: "CloudProvider",
        provider: selectedCloudProvider,
        api_key: apiKey,
        base_url:
          selectedCloudProvider === "custom" ? customBaseUrl : provider.baseUrl,
        model: provider.defaultModel,
      });
      onModelSelected();
    } catch (err) {
      console.error("Failed to set cloud provider:", err);
      setError(String(err));
      setIsSubmitting(false);
    }
  };

  const toggleSection = (section: ExpandedSection) => {
    setExpandedSection(expandedSection === section ? null : section);
    // Reset cloud provider selection when closing
    if (section === "cloud" && expandedSection === "cloud") {
      setSelectedCloudProvider(null);
      setApiKey("");
    }
  };

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) return "extracting";
    if (modelId in verifyingModels) return "verifying";
    if (modelId in downloadingModels) return "downloading";
    return "downloadable";
  };

  const getModelDownloadProgress = (modelId: string): number | undefined => {
    return downloadProgress[modelId]?.percentage;
  };

  const getModelDownloadSpeed = (modelId: string): number | undefined => {
    return downloadStats[modelId]?.speed;
  };

  const availableModels = models.filter((m: ModelInfo) => !m.is_downloaded);
  const recommendedModels = availableModels.filter(
    (m: ModelInfo) => m.is_recommended,
  );
  const otherModels = availableModels
    .filter((m: ModelInfo) => !m.is_recommended)
    .sort(
      (a: ModelInfo, b: ModelInfo) => Number(a.size_mb) - Number(b.size_mb),
    );

  return (
    <div className="h-screen w-screen flex flex-col p-6 gap-4 inset-0">
      <div className="flex flex-col items-center gap-2 shrink-0">
        <HandyTextLogo width={200} />
        <p className="text-text/70 max-w-md font-medium mx-auto">
          {t("onboarding.subtitle")}
        </p>
      </div>

      <div className="max-w-[600px] w-full mx-auto flex-1 flex flex-col min-h-0 overflow-y-auto">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 shrink-0">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {/* Local Models Section */}
          <div className="rounded-xl border border-mid-gray/20 overflow-hidden">
            <button
              onClick={() => toggleSection("local")}
              className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <HardDrive className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-text">Local Models</p>
                  <p className="text-xs text-text/60">
                    Download and run on your device
                  </p>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-text/50 transition-transform duration-200 ${
                  expandedSection === "local" ? "rotate-180" : ""
                }`}
              />
            </button>

            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                expandedSection === "local"
                  ? "max-h-[600px] opacity-100"
                  : "max-h-0 opacity-0"
              }`}
            >
              <div className="p-4 pt-0 flex flex-col gap-3">
                {recommendedModels.map((model: ModelInfo) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    variant="featured"
                    status={getModelStatus(model.id)}
                    disabled={isDownloading}
                    onSelect={handleDownloadModel}
                    onDownload={handleDownloadModel}
                    downloadProgress={getModelDownloadProgress(model.id)}
                    downloadSpeed={getModelDownloadSpeed(model.id)}
                  />
                ))}
                {otherModels.map((model: ModelInfo) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    status={getModelStatus(model.id)}
                    disabled={isDownloading}
                    onSelect={handleDownloadModel}
                    onDownload={handleDownloadModel}
                    downloadProgress={getModelDownloadProgress(model.id)}
                    downloadSpeed={getModelDownloadSpeed(model.id)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Cloud API Section */}
          <div className="rounded-xl border border-mid-gray/20 overflow-hidden">
            <button
              onClick={() => toggleSection("cloud")}
              className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Cloud className="w-5 h-5 text-blue-400" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-text">Cloud API</p>
                  <p className="text-xs text-text/60">No download required</p>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-text/50 transition-transform duration-200 ${
                  expandedSection === "cloud" ? "rotate-180" : ""
                }`}
              />
            </button>

            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                expandedSection === "cloud"
                  ? "max-h-[500px] opacity-100"
                  : "max-h-0 opacity-0"
              }`}
            >
              <div className="p-4 pt-0 flex flex-col gap-2">
                {/* Provider Selection */}
                {cloudProviders.map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => handleCloudProviderSelect(provider.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      selectedCloudProvider === provider.id
                        ? "border-logo-primary bg-logo-primary/10"
                        : "border-mid-gray/20 hover:border-mid-gray/40 hover:bg-white/5"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                        selectedCloudProvider === provider.id
                          ? "border-logo-primary"
                          : "border-mid-gray/40"
                      }`}
                    >
                      {selectedCloudProvider === provider.id && (
                        <div className="w-2 h-2 rounded-full bg-logo-primary" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-text">{provider.name}</p>
                        {provider.id === "groq" && (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                            <Zap className="w-3 h-3" />
                            Fast
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text/60">
                        {provider.description}
                      </p>
                    </div>
                  </button>
                ))}

                {/* API Key Input - shown when provider selected */}
                {selectedCloudProvider && (
                  <div className="mt-3 flex flex-col gap-3 p-3 rounded-lg bg-white/5 border border-mid-gray/20">
                    {selectedCloudProvider === "custom" && (
                      <div>
                        <label className="block text-xs font-medium text-text/70 mb-1.5">
                          Base URL
                        </label>
                        <Input
                          type="text"
                          value={customBaseUrl}
                          onChange={(e) => setCustomBaseUrl(e.target.value)}
                          placeholder="http://localhost:8080/v1"
                          className="w-full"
                          variant="compact"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-text/70 mb-1.5">
                        API Key{" "}
                        {selectedCloudProvider !== "custom" && (
                          <span className="text-text/40">(required)</span>
                        )}
                      </label>
                      <Input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Enter your API key"
                        className="w-full"
                        variant="compact"
                      />
                    </div>
                    <button
                      onClick={handleCloudSubmit}
                      disabled={
                        isSubmitting ||
                        (!apiKey && selectedCloudProvider !== "custom")
                      }
                      className="w-full py-2.5 px-4 rounded-lg bg-logo-primary hover:bg-logo-primary/90 disabled:bg-mid-gray/30 disabled:cursor-not-allowed text-white font-medium transition-colors"
                    >
                      {isSubmitting ? "Setting up..." : "Continue"}
                    </button>
                    <p className="text-[11px] text-text/50 text-center">
                      You can change this later in Settings
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
