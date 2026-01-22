import React from "react";
import type { Controls } from "@/components/InteractiveHeroBanner";
import type { BannerPreset } from "@/presets/presets";
import { encodePresetForUrl } from "@/presets/presets";

const MAX_SAVED_PRESETS = 5;

type SavedPresetsPanelProps = {
  controls: Controls;
  colorStops: string[];
  updateControl: (key: keyof Controls, value: number) => void;
  setColorStops: (stops: string[]) => void;
  savedPresets: BannerPreset[];
  setSavedPresets: (presets: BannerPreset[]) => void;
  onSelectPresetName: (name: string) => void;
};

const formatPresetLabel = (preset: BannerPreset, index: number) =>
  preset.name?.trim() ? preset.name : `Preset ${index + 1}`;

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleString();

const applyPreset = (
  preset: BannerPreset,
  updateControl: (key: keyof Controls, value: number) => void,
  setColorStops: (stops: string[]) => void,
  onSelectPresetName: (name: string) => void
) => {
  setColorStops(preset.colorStops);
  Object.entries(preset.controls).forEach(([key, value]) => {
    updateControl(key as keyof Controls, value as number);
  });
  onSelectPresetName("Custom");
};

const copyPresetLink = async (preset: BannerPreset) => {
  if (typeof window === "undefined") return;
  const encoded = encodePresetForUrl(preset);
  const url = `${window.location.origin}/?preset=${encoded}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt("Copy this preset URL:", url);
  }
};

const SavedPresetsPanel: React.FC<SavedPresetsPanelProps> = ({
  controls,
  colorStops,
  updateControl,
  setColorStops,
  savedPresets,
  setSavedPresets,
  onSelectPresetName,
}) => {
  const atLimit = savedPresets.length >= MAX_SAVED_PRESETS;

  const handleSave = () => {
    if (atLimit) return;
    const nameInput = window.prompt("Preset name (optional):", "");
    if (nameInput === null) return;
    const trimmedName = nameInput.trim();
    const newPreset: BannerPreset = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: trimmedName || undefined,
      createdAt: Date.now(),
      controls: { ...controls },
      colorStops: [...colorStops],
    };
    setSavedPresets([newPreset, ...savedPresets]);
  };

  const handleRename = (preset: BannerPreset) => {
    const current = preset.name ?? "";
    const nextName = window.prompt("Rename preset:", current);
    if (nextName === null) return;
    const trimmed = nextName.trim();
    setSavedPresets(
      savedPresets.map((item) =>
        item.id === preset.id ? { ...item, name: trimmed || undefined } : item
      )
    );
  };

  const handleDelete = (preset: BannerPreset) => {
    setSavedPresets(savedPresets.filter((item) => item.id !== preset.id));
  };

  return (
    <div className="mt-4 p-4 rounded-xl text-xs"
      style={{
        background: "rgba(15, 15, 15, 0.9)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">Saved Presets</span>
        <button
          onClick={handleSave}
          disabled={atLimit}
          className={`px-2 py-1 rounded-md text-[10px] uppercase tracking-wider transition-colors ${
            atLimit
              ? "bg-neutral-800 text-neutral-600 cursor-not-allowed"
              : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
          }`}
        >
          Save
        </button>
      </div>
      {atLimit && (
        <div className="mt-2 text-[10px] text-neutral-500">
          Limit reached (5)
        </div>
      )}
      <div className="mt-3 space-y-2">
        {savedPresets.length === 0 && (
          <div className="text-[10px] text-neutral-500">
            No presets saved yet.
          </div>
        )}
        {savedPresets.map((preset, index) => (
          <div
            key={preset.id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-white/5 bg-neutral-900/40 px-2 py-2"
          >
            <div className="flex-1 min-w-[180px]">
              <div className="text-[11px] text-neutral-200">
                {formatPresetLabel(preset, index)}
              </div>
              <div className="text-[10px] text-neutral-500">
                {formatTimestamp(preset.createdAt)}
              </div>
            </div>
            <button
              onClick={() => applyPreset(preset, updateControl, setColorStops, onSelectPresetName)}
              className="px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors"
            >
              Load
            </button>
            <button
              onClick={() => handleRename(preset)}
              className="px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors"
            >
              Rename
            </button>
            <button
              onClick={() => copyPresetLink(preset)}
              className="px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors"
            >
              Copy Embed Link
            </button>
            <button
              onClick={() => handleDelete(preset)}
              className="px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SavedPresetsPanel;
