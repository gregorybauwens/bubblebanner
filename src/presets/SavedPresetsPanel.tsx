import React from "react";
import type { Controls } from "@/components/InteractiveHeroBanner";
import type { BannerPreset } from "@/presets/presets";

const MAX_SAVED_PRESETS = 5;

type SavedPresetsPanelProps = {
  controls: Controls;
  colorStops: string[];
  selectedColorPresetName: string;
  activeSavedPresetId: string | null;
  onActivateSavedPresetId: (id: string | null) => void;
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

const SavedPresetsPanel: React.FC<SavedPresetsPanelProps> = ({
  controls,
  colorStops,
  selectedColorPresetName,
  activeSavedPresetId,
  onActivateSavedPresetId,
  updateControl,
  setColorStops,
  savedPresets,
  setSavedPresets,
  onSelectPresetName,
}) => {
  const atLimit = savedPresets.length >= MAX_SAVED_PRESETS;

  const handleSave = () => {
    if (atLimit) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const createdAt = Date.now();
    // Avoid `window.prompt()` because it's often blocked (especially in embeds/iframes).
    // Save immediately, and allow renaming later.
    setSavedPresets((prev) => {
      const baseName =
        selectedColorPresetName?.trim() && selectedColorPresetName !== "Custom"
          ? selectedColorPresetName.trim()
          : "Custom";

      // Generate a friendly deduped name: "Nebula", "Nebula 2", "Nebula 3", ...
      const existing = prev
        .map((p) => p.name?.trim() || "")
        .filter((name) => name === baseName || name.startsWith(`${baseName} `));

      const nextNumber = existing.length + 1;
      const dedupedName = existing.length === 0 ? baseName : `${baseName} ${nextNumber}`;

      const newPreset: BannerPreset = {
        id,
        name: dedupedName,
        createdAt,
        controls: { ...controls },
        colorStops: [...colorStops],
      };

      return [newPreset, ...prev].slice(0, MAX_SAVED_PRESETS);
    });
    onActivateSavedPresetId(id);
  };

  const handleDelete = (preset: BannerPreset) => {
    if (activeSavedPresetId === preset.id) onActivateSavedPresetId(null);
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {savedPresets.length === 0 && (
          <div className="text-[10px] text-neutral-500">
            No presets saved yet.
          </div>
        )}
        {savedPresets.map((preset, index) => (
          <div
            key={preset.id}
            className="flex items-center gap-2"
          >
            {/*
              Pill styling matches the color preset buttons above:
              selected = neutral-700 + border-neutral-500
            */}
            <button
              onClick={() => {
                onActivateSavedPresetId(preset.id);
                applyPreset(preset, updateControl, setColorStops, onSelectPresetName);
              }}
              title={`Load • ${formatTimestamp(preset.createdAt)}`}
              className={`px-2 py-1 rounded-md text-[10px] uppercase tracking-wider transition-colors border inline-flex items-center gap-2 ${
                activeSavedPresetId === preset.id
                  ? "bg-neutral-700 text-neutral-100 border-neutral-500"
                  : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-transparent"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex -space-x-1">
                  {(preset.colorStops || []).slice(0, 3).map((c, i) => (
                    <span
                      key={`${preset.id}-swatch-${i}`}
                      className="h-3 w-3 rounded border border-white/10"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                <span>{formatPresetLabel(preset, index)}</span>
              </span>
            </button>
            <button
              onClick={() => handleDelete(preset)}
              title="Delete"
              className="px-2 py-1 rounded-md text-[10px] uppercase tracking-wider transition-colors border bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-transparent"
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
