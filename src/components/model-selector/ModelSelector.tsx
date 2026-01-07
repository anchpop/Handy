import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { commands, type ModelInfo, type TranscriptionProviderConfig } from "@/bindings";
import { getTranslatedModelName } from "../../lib/utils/modelTranslation";
import ModelStatusButton from "./ModelStatusButton";
import ModelDropdown from "./ModelDropdown";
import DownloadProgressDisplay from "./DownloadProgressDisplay";

// Helper to get cloud provider display name
const getCloudProviderDisplayName = (config: TranscriptionProviderConfig): string => {
  if (config.type !== "CloudProvider") return "";
  switch (config.provider) {
    case "openai":
      return "OpenAI Whisper API";
    case "groq":
      return "Groq Whisper API";
    case "custom":
      return "Custom API";
  }
};

interface ModelStateEvent {
  event_type: string;
  model_id?: string;
  model_name?: string;
  error?: string;
}

interface DownloadProgress {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
}

type LocalModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

// Discriminated union ensures cloud provider name is always present when using cloud
type TranscriptionState =
  | { type: "cloud"; providerName: string }
  | { type: "local"; status: LocalModelStatus; error: string | null };

interface DownloadStats {
  startTime: number;
  lastUpdate: number;
  totalDownloaded: number;
  speed: number;
}

interface ModelSelectorProps {
  onError?: (error: string) => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ onError }) => {
  const { t } = useTranslation();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModelId, setCurrentModelId] = useState<string>("");
  // Single state for transcription source - discriminated union prevents invalid states
  const [transcriptionState, setTranscriptionState] = useState<TranscriptionState>({
    type: "local",
    status: "unloaded",
    error: null,
  });
  const [modelDownloadProgress, setModelDownloadProgress] = useState<
    Map<string, DownloadProgress>
  >(new Map());
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [downloadStats, setDownloadStats] = useState<
    Map<string, DownloadStats>
  >(new Map());
  const [extractingModels, setExtractingModels] = useState<Set<string>>(
    new Set(),
  );

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initialize state - run load functions and ensure state is set correctly
    const initialize = async () => {
      await loadModels();
      // Load both config handlers - one of them will set the correct state
      await loadTranscriptionProvider();
      await loadCurrentModel();
    };
    initialize();

    // Listen for model state changes
    const modelStateUnlisten = listen<ModelStateEvent>(
      "model-state-changed",
      (event) => {
        const { event_type, model_id, error } = event.payload;

        switch (event_type) {
          case "loading_started":
            setTranscriptionState({ type: "local", status: "loading", error: null });
            break;
          case "loading_completed":
            setTranscriptionState({ type: "local", status: "ready", error: null });
            if (model_id) setCurrentModelId(model_id);
            break;
          case "loading_failed":
            setTranscriptionState({ type: "local", status: "error", error: error || "Failed to load model" });
            break;
          case "unloaded":
            setTranscriptionState({ type: "local", status: "unloaded", error: null });
            break;
        }
      },
    );

    // Listen for model download progress
    const downloadProgressUnlisten = listen<DownloadProgress>(
      "model-download-progress",
      (event) => {
        const progress = event.payload;
        setModelDownloadProgress((prev) => {
          const newMap = new Map(prev);
          newMap.set(progress.model_id, progress);
          return newMap;
        });
        setTranscriptionState({ type: "local", status: "downloading", error: null });

        // Update download stats for speed calculation
        const now = Date.now();
        setDownloadStats((prev) => {
          const current = prev.get(progress.model_id);
          const newStats = new Map(prev);

          if (!current) {
            // First progress update - initialize
            newStats.set(progress.model_id, {
              startTime: now,
              lastUpdate: now,
              totalDownloaded: progress.downloaded,
              speed: 0,
            });
          } else {
            // Calculate speed over last few seconds
            const timeDiff = (now - current.lastUpdate) / 1000; // seconds
            const bytesDiff = progress.downloaded - current.totalDownloaded;

            if (timeDiff > 0.5) {
              // Update speed every 500ms
              const currentSpeed = bytesDiff / (1024 * 1024) / timeDiff; // MB/s
              // Smooth the speed with exponential moving average, but ensure positive values
              const validCurrentSpeed = Math.max(0, currentSpeed);
              const smoothedSpeed =
                current.speed > 0
                  ? current.speed * 0.8 + validCurrentSpeed * 0.2
                  : validCurrentSpeed;

              newStats.set(progress.model_id, {
                startTime: current.startTime,
                lastUpdate: now,
                totalDownloaded: progress.downloaded,
                speed: Math.max(0, smoothedSpeed),
              });
            }
          }

          return newStats;
        });
      },
    );

    // Listen for model download completion
    const downloadCompleteUnlisten = listen<string>(
      "model-download-complete",
      (event) => {
        const modelId = event.payload;
        setModelDownloadProgress((prev) => {
          const newMap = new Map(prev);
          newMap.delete(modelId);
          return newMap;
        });
        setDownloadStats((prev) => {
          const newStats = new Map(prev);
          newStats.delete(modelId);
          return newStats;
        });
        loadModels(); // Refresh models list

        // Auto-select the newly downloaded model (skip if recording in progress)
        setTimeout(async () => {
          const isRecording = await commands.isRecording();
          if (isRecording) {
            return; // Skip auto-switch if recording in progress
          }
          loadCurrentModel();
          handleModelSelect(modelId);
        }, 500);
      },
    );

    // Listen for extraction events
    const extractionStartedUnlisten = listen<string>(
      "model-extraction-started",
      (event) => {
        const modelId = event.payload;
        setExtractingModels((prev) => new Set(prev.add(modelId)));
        setTranscriptionState({ type: "local", status: "extracting", error: null });
      },
    );

    const extractionCompletedUnlisten = listen<string>(
      "model-extraction-completed",
      (event) => {
        const modelId = event.payload;
        setExtractingModels((prev) => {
          const next = new Set(prev);
          next.delete(modelId);
          return next;
        });
        loadModels(); // Refresh models list

        // Auto-select the newly extracted model (skip if recording in progress)
        setTimeout(async () => {
          const isRecording = await commands.isRecording();
          if (isRecording) {
            return; // Skip auto-switch if recording in progress
          }
          loadCurrentModel();
          handleModelSelect(modelId);
        }, 500);
      },
    );

    const extractionFailedUnlisten = listen<{
      model_id: string;
      error: string;
    }>("model-extraction-failed", (event) => {
      const modelId = event.payload.model_id;
      setExtractingModels((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
      setTranscriptionState({ type: "local", status: "error", error: `Failed to extract model: ${event.payload.error}` });
    });

    // Listen for settings changes (e.g., transcription provider change)
    const settingsChangedUnlisten = listen<{ setting: string; value: unknown }>(
      "settings-changed",
      () => {
        // Reload transcription provider when settings change
        loadTranscriptionProvider();
      },
    );

    // Click outside to close dropdown
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowModelDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      modelStateUnlisten.then((fn) => fn());
      downloadProgressUnlisten.then((fn) => fn());
      downloadCompleteUnlisten.then((fn) => fn());
      extractionStartedUnlisten.then((fn) => fn());
      extractionCompletedUnlisten.then((fn) => fn());
      extractionFailedUnlisten.then((fn) => fn());
      settingsChangedUnlisten.then((fn) => fn());
    };
  }, []);

  const loadModels = async () => {
    try {
      const result = await commands.getAvailableModels();
      if (result.status === "ok") {
        setModels(result.data);
      }
    } catch (err) {
      console.error("Failed to load models:", err);
    }
  };

  const loadCurrentModel = async () => {
    try {
      // Check if we're using cloud provider - if so, don't update model status
      const configResult = await commands.getTranscriptionConfig();
      if (configResult.status === "ok" && configResult.data.type === "CloudProvider") {
        return; // Cloud provider handles its own status via loadTranscriptionProvider
      }

      const result = await commands.getCurrentModel();
      if (result.status === "ok") {
        const current = result.data;
        setCurrentModelId(current);

        if (current) {
          // Check if model is actually loaded
          const statusResult = await commands.getTranscriptionModelStatus();
          if (statusResult.status === "ok") {
            const transcriptionStatus = statusResult.data;
            if (transcriptionStatus === current) {
              setTranscriptionState({ type: "local", status: "ready", error: null });
            } else {
              setTranscriptionState({ type: "local", status: "unloaded", error: null });
            }
          } else {
            // Failed to get status - assume unloaded
            setTranscriptionState({ type: "local", status: "unloaded", error: null });
          }
        } else {
          setTranscriptionState({ type: "local", status: "none", error: null });
        }
      } else {
        // Failed to get current model - show as none
        setTranscriptionState({ type: "local", status: "none", error: null });
      }
    } catch (err) {
      console.error("Failed to load current model:", err);
      setTranscriptionState({ type: "local", status: "error", error: "Failed to check model status" });
    }
  };

  const loadTranscriptionProvider = async () => {
    try {
      const result = await commands.getTranscriptionConfig();
      if (result.status === "ok") {
        const config = result.data;
        if (config.type === "CloudProvider") {
          // Type system ensures we always set providerName when type is "cloud"
          setTranscriptionState({ type: "cloud", providerName: getCloudProviderDisplayName(config) });
        }
        // Don't override state if we're local - let loadCurrentModel handle it
      }
    } catch (err) {
      console.error("Failed to load transcription provider:", err);
    }
  };

  const handleModelSelect = async (modelId: string) => {
    try {
      setCurrentModelId(modelId); // Set optimistically so loading text shows correct model
      setShowModelDropdown(false);
      const result = await commands.setActiveModel(modelId);
      if (result.status === "error") {
        const errorMsg = result.error;
        setTranscriptionState({ type: "local", status: "error", error: errorMsg });
        onError?.(errorMsg);
      }
    } catch (err) {
      const errorMsg = `${err}`;
      setTranscriptionState({ type: "local", status: "error", error: errorMsg });
      onError?.(errorMsg);
    }
  };

  const handleModelDownload = async (modelId: string) => {
    try {
      const result = await commands.downloadModel(modelId);
      if (result.status === "error") {
        const errorMsg = result.error;
        setTranscriptionState({ type: "local", status: "error", error: errorMsg });
        onError?.(errorMsg);
      }
    } catch (err) {
      const errorMsg = `${err}`;
      setTranscriptionState({ type: "local", status: "error", error: errorMsg });
      onError?.(errorMsg);
    }
  };

  const getCurrentModel = () => {
    return models.find((m) => m.id === currentModelId);
  };

  const getModelDisplayText = (): string => {
    if (extractingModels.size > 0) {
      if (extractingModels.size === 1) {
        const [modelId] = Array.from(extractingModels);
        const model = models.find((m) => m.id === modelId);
        const modelName = model
          ? getTranslatedModelName(model, t)
          : t("modelSelector.extractingGeneric").replace("...", "");
        return t("modelSelector.extracting", { modelName });
      } else {
        return t("modelSelector.extractingMultiple", {
          count: extractingModels.size,
        });
      }
    }

    if (modelDownloadProgress.size > 0) {
      if (modelDownloadProgress.size === 1) {
        const [progress] = Array.from(modelDownloadProgress.values());
        const percentage = Math.max(
          0,
          Math.min(100, Math.round(progress.percentage)),
        );
        return t("modelSelector.downloading", { percentage });
      } else {
        return t("modelSelector.downloadingMultiple", {
          count: modelDownloadProgress.size,
        });
      }
    }

    // Handle discriminated union - cloud vs local
    if (transcriptionState.type === "cloud") {
      // Type narrowing guarantees providerName exists
      return t("modelSelector.cloudProvider", { provider: transcriptionState.providerName });
    }

    // Type narrowing: we know it's local from here
    const { status, error } = transcriptionState;
    const currentModel = getCurrentModel();

    switch (status) {
      case "ready":
        return currentModel
          ? getTranslatedModelName(currentModel, t)
          : t("modelSelector.modelReady");
      case "loading":
        return currentModel
          ? t("modelSelector.loading", {
              modelName: getTranslatedModelName(currentModel, t),
            })
          : t("modelSelector.loadingGeneric");
      case "extracting":
        return currentModel
          ? t("modelSelector.extracting", {
              modelName: getTranslatedModelName(currentModel, t),
            })
          : t("modelSelector.extractingGeneric");
      case "error":
        return error || t("modelSelector.modelError");
      case "unloaded":
        return currentModel
          ? getTranslatedModelName(currentModel, t)
          : t("modelSelector.modelUnloaded");
      case "none":
        return t("modelSelector.noModelDownloadRequired");
      case "downloading":
        return t("modelSelector.downloadingGeneric");
      default:
        return currentModel
          ? getTranslatedModelName(currentModel, t)
          : t("modelSelector.modelUnloaded");
    }
  };

  const handleModelDelete = async (modelId: string) => {
    const result = await commands.deleteModel(modelId);
    if (result.status === "ok") {
      await loadModels();
    }
  };

  // Compute status for the button indicator
  const getButtonStatus = (): "ready" | "loading" | "downloading" | "extracting" | "error" | "unloaded" | "none" | "cloud" => {
    if (transcriptionState.type === "cloud") return "cloud";
    return transcriptionState.status;
  };

  return (
    <>
      {/* Model Status and Switcher */}
      <div className="relative" ref={dropdownRef}>
        <ModelStatusButton
          status={getButtonStatus()}
          displayText={getModelDisplayText()}
          isDropdownOpen={showModelDropdown}
          onClick={() => setShowModelDropdown(!showModelDropdown)}
        />

        {/* Model Dropdown */}
        {showModelDropdown && (
          <ModelDropdown
            models={models}
            currentModelId={currentModelId}
            downloadProgress={modelDownloadProgress}
            onModelSelect={handleModelSelect}
            onModelDownload={handleModelDownload}
            onModelDelete={handleModelDelete}
            onError={onError}
          />
        )}
      </div>

      {/* Download Progress Bar for Models */}
      <DownloadProgressDisplay
        downloadProgress={modelDownloadProgress}
        downloadStats={downloadStats}
      />
    </>
  );
};

export default ModelSelector;
