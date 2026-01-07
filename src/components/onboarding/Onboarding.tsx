import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { commands, type ModelInfo, type CloudProviderType } from "@/bindings";
import ModelCard from "./ModelCard";
import HandyTextLogo from "../icons/HandyTextLogo";
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
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>("local");

  // Cloud provider state
  const [selectedCloudProvider, setSelectedCloudProvider] = useState<CloudProviderType | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("http://localhost:8080/v1");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const result = await commands.getAvailableModels();
      if (result.status === "ok") {
        setAvailableModels(result.data.filter((m) => !m.is_downloaded));
      } else {
        setError(t("onboarding.errors.loadModels"));
      }
    } catch (err) {
      console.error("Failed to load models:", err);
      setError(t("onboarding.errors.loadModels"));
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    setDownloading(true);
    setError(null);
    onModelSelected();

    try {
      const result = await commands.downloadModel(modelId);
      if (result.status === "error") {
        console.error("Download failed:", result.error);
        setError(t("onboarding.errors.downloadModel", { error: result.error }));
        setDownloading(false);
      }
    } catch (err) {
      console.error("Download failed:", err);
      setError(t("onboarding.errors.downloadModel", { error: String(err) }));
      setDownloading(false);
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
        base_url: selectedCloudProvider === "custom" ? customBaseUrl : provider.baseUrl,
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

  const getRecommendedBadge = (modelId: string): boolean => {
    return modelId === "parakeet-tdt-0.6b-v3";
  };

  const recommendedModels = availableModels.filter((m) => getRecommendedBadge(m.id));
  const otherModels = availableModels
    .filter((m) => !getRecommendedBadge(m.id))
    .sort((a, b) => Number(a.size_mb) - Number(b.size_mb));

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
                  <p className="text-xs text-text/60">Download and run on your device</p>
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
                expandedSection === "local" ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <div className="p-4 pt-0 flex flex-col gap-3">
                {recommendedModels.map((model) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    variant="featured"
                    disabled={downloading}
                    onSelect={handleDownloadModel}
                  />
                ))}
                {otherModels.map((model) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    disabled={downloading}
                    onSelect={handleDownloadModel}
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
                expandedSection === "cloud" ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
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
                      <p className="text-xs text-text/60">{provider.description}</p>
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
                        API Key {selectedCloudProvider !== "custom" && <span className="text-text/40">(required)</span>}
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
                      disabled={isSubmitting || (!apiKey && selectedCloudProvider !== "custom")}
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
