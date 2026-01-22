import InteractiveHeroBanner, { ControlSlider, DEFAULT_COLOR_STOPS, type ControlPanelProps, type Controls } from "@/components/InteractiveHeroBanner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEffect, useMemo, useState } from "react";
import ColorPickerGradient from "@/components/ColorPickerGradient";
import SavedPresetsPanel from "@/presets/SavedPresetsPanel";
import {
  decodePresetFromUrl,
  loadPresetsFromStorage,
  savePresetsToStorage,
  type BannerPreset,
} from "@/presets/presets";

type ControlPanelExtraProps = {
  colorStops: string[];
  setColorStops: (stops: string[]) => void;
  selectedPreset: string;
  setSelectedPreset: (name: string) => void;
  savedPresets: BannerPreset[];
  setSavedPresets: (presets: BannerPreset[]) => void;
  pendingPreset: BannerPreset | null;
  clearPendingPreset: () => void;
  onSyncBannerState: (controls: Controls, updateControl: (key: keyof Controls, value: number) => void) => void;
};

const ControlPanel = ({
  controls,
  updateControl,
  onReset,
  isPaused,
  setIsPaused,
  colorStops,
  setColorStops,
  selectedPreset,
  setSelectedPreset,
  savedPresets,
  setSavedPresets,
  pendingPreset,
  clearPendingPreset,
  onSyncBannerState,
}: ControlPanelProps & ControlPanelExtraProps) => {
  useEffect(() => {
    onSyncBannerState(controls, updateControl);
  }, [controls, updateControl, onSyncBannerState]);

  useEffect(() => {
    if (!pendingPreset) return;
    setColorStops(pendingPreset.colorStops);
    Object.entries(pendingPreset.controls).forEach(([key, value]) => {
      updateControl(key as keyof Controls, value as number);
    });
    setSelectedPreset(pendingPreset.name?.trim() || "Custom");
    clearPendingPreset();
  }, [
    pendingPreset,
    setColorStops,
    updateControl,
    setSelectedPreset,
    clearPendingPreset,
  ]);

  return (
  <div
    className="mt-6 p-4 rounded-xl text-xs"
    style={{
      background: "rgba(15, 15, 15, 0.9)",
      backdropFilter: "blur(12px)",
      border: "1px solid rgba(255, 255, 255, 0.08)",
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
    }}
  >
    <div className="flex flex-wrap gap-4 items-start">
      {/* Hover Controls */}
      <div className="min-w-[180px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Hover</label>
        <div className="space-y-1">
          <ControlSlider label="Strength" value={controls.hoverStrength} onChange={(v) => updateControl("hoverStrength", v)} min={0} max={3} />
          <ControlSlider label="Radius" value={controls.hoverRadius} onChange={(v) => updateControl("hoverRadius", v)} min={0.1} max={1} />
        </div>
      </div>

      {/* Physics Controls */}
      <div className="min-w-[180px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Physics</label>
        <div className="space-y-1">
          <ControlSlider label="Spring" value={controls.spring} onChange={(v) => updateControl("spring", v)} min={0.1} max={2} />
          <ControlSlider label="Damping" value={controls.damping} onChange={(v) => updateControl("damping", v)} min={0.1} max={2} />
        </div>
      </div>

      {/* Shatter controls */}
      <div className="min-w-[180px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Shatter</label>
        <div className="space-y-1">
          <ControlSlider label="Spread" value={controls.shardSpread} onChange={(v) => updateControl("shardSpread", v)} min={0.1} max={3} />
          <ControlSlider label="Force" value={controls.explosionForce} onChange={(v) => updateControl("explosionForce", v)} min={0.3} max={3} />
          <ControlSlider label="Spin" value={controls.explosionSpin} onChange={(v) => updateControl("explosionSpin", v)} min={0} max={3} />
        </div>
      </div>

      {/* Settle controls */}
      <div className="min-w-[180px] flex-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Settle</label>
        <div className="space-y-1">
          <ControlSlider label="Delay" value={controls.settleTime} onChange={(v) => updateControl("settleTime", v)} min={0} max={5} />
          <ControlSlider label="Speed" value={controls.returnSpring} onChange={(v) => updateControl("returnSpring", v)} min={0.5} max={5} />
          <ControlSlider label="Ease" value={controls.settleDamping} onChange={(v) => updateControl("settleDamping", v)} min={0} max={2} />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-1.5 min-w-[90px]">
        <button onClick={onReset} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors">
          Reset
        </button>
        <button onClick={() => setIsPaused(!isPaused)} className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors">
          {isPaused ? "Play" : "Pause"}
        </button>
      </div>
    </div>
  </div>
);
};

const Index = () => {
  const [colorStops, setColorStops] = useState<string[]>(DEFAULT_COLOR_STOPS);
  const [selectedPreset, setSelectedPreset] = useState<string>("Original");
  const [savedPresets, setSavedPresets] = useState<BannerPreset[]>(() => loadPresetsFromStorage());
  const [pendingPreset, setPendingPreset] = useState<BannerPreset | null>(null);
  const [bannerControls, setBannerControls] = useState<Controls | null>(null);
  const [bannerUpdateControl, setBannerUpdateControl] = useState<((key: keyof Controls, value: number) => void) | null>(null);
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null);
  const normalizedStops = useMemo(
    () => colorStops.map((stop) => stop.trim().toUpperCase()),
    [colorStops]
  );
  const colorPresetGroups = useMemo(
    () => [
      {
        name: "Base",
        presets: [
          { name: "Original", stops: DEFAULT_COLOR_STOPS },
          { name: "Polar", stops: ["#F8F9FA", "#E9ECEF", "#DEE2E6", "#ADB5BD", "#6C757D", "#343A40"] },
          { name: "Stone", stops: ["#F5F5F4", "#E7E5E4", "#D6D3D1", "#A8A29E", "#78716C", "#57534E"] },
          { name: "Slate", stops: ["#F8FAFC", "#E2E8F0", "#CBD5E1", "#94A3B8", "#64748B", "#334155"] },
          { name: "Ice", stops: ["#F8FAFC", "#E2E8F0", "#CBD5E1", "#94A3B8", "#64748B", "#475569"] },
          { name: "Sand", stops: ["#FFF8E7", "#FEEED4", "#FCE1B3", "#F5C98C", "#E0A96D", "#B97A56"] },
          { name: "Midnight", stops: ["#0F172A", "#1E293B", "#334155", "#475569", "#64748B", "#94A3B8"] },
        ],
      },
      {
        name: "Warm",
        presets: [
          { name: "Sunset", stops: ["#FFD166", "#FCA311", "#F77F00", "#F25C54", "#D62828", "#A4161A"] },
          { name: "Citrus", stops: ["#FFF3B0", "#FFD166", "#F4D35E", "#EE964B", "#F95738", "#EE6C4D"] },
          { name: "Ember", stops: ["#FFEA00", "#FFB703", "#FB8500", "#F48C06", "#E85D04", "#9D0208"] },
          { name: "Gold", stops: ["#FFF7D6", "#FDE9A9", "#F9D976", "#F4B63E", "#D9961A", "#B87400"] },
          { name: "Honey", stops: ["#FFF4CC", "#FFE08A", "#FFC857", "#FCA311", "#F77F00", "#D9480F"] },
          { name: "Copper", stops: ["#FFF1E6", "#FFD7BA", "#FFB48F", "#F28F3B", "#C8553D", "#6F1D1B"] },
          { name: "Terracotta", stops: ["#FFF3E0", "#FFE0B2", "#FFCC80", "#FFB74D", "#F57C00", "#E65100"] },
          { name: "Mango", stops: ["#FFF3B0", "#FFE066", "#FFD23F", "#F9C74F", "#F8961E", "#F9844A"] },
          { name: "Peach", stops: ["#FFF1E6", "#FFD7BA", "#FFC6A8", "#FFAD7A", "#FF8F56", "#F15A24"] },
        ],
      },
      {
        name: "Red + Pink",
        presets: [
          { name: "Coral", stops: ["#FFE5D9", "#FFCAD4", "#F4ACB7", "#F08080", "#E85D75", "#D1495B"] },
          { name: "Rose", stops: ["#FFF0F3", "#FFCCD5", "#FFB3C6", "#FF8FAB", "#FB6F92", "#E11D48"] },
          { name: "Blush", stops: ["#FFF5F5", "#FEE2E2", "#FECACA", "#FCA5A5", "#F87171", "#EF4444"] },
          { name: "Berry", stops: ["#3A0CA3", "#5F0F40", "#9A031E", "#E36414", "#F48C06", "#F8C4B4"] },
          { name: "Cherry", stops: ["#1F0A1E", "#3D0E2F", "#6A0F49", "#A4161A", "#D62828", "#FF6B6B"] },
          { name: "Candy", stops: ["#FEC5BB", "#FCD5CE", "#FAE1DD", "#F8EDEB", "#F9DCC4", "#F6BD60"] },
        ],
      },
      {
        name: "Green",
        presets: [
          { name: "Lagoon", stops: ["#D8F3DC", "#B7E4C7", "#95D5B2", "#74C69D", "#52B788", "#40916C"] },
          { name: "Mint", stops: ["#F0FFF1", "#D7FBE8", "#B8F2E6", "#9DD9D2", "#7DCFB6", "#4ECDC4"] },
          { name: "Jade", stops: ["#E9F5DB", "#CFE1B9", "#B5C99A", "#97A97C", "#87986A", "#718355"] },
          { name: "Sage", stops: ["#EDF6F9", "#D6E5E3", "#B8C5C0", "#9DA9A0", "#7F8F86", "#5D6B63"] },
          { name: "Lime", stops: ["#F7FEE7", "#ECFCCB", "#D9F99D", "#A3E635", "#65A30D", "#3F6212"] },
          { name: "Leaf", stops: ["#ECFDF3", "#D1FAE5", "#A7F3D0", "#6EE7B7", "#34D399", "#059669"] },
          { name: "Forest", stops: ["#0B3D20", "#14532D", "#166534", "#15803D", "#16A34A", "#22C55E"] },
        ],
      },
      {
        name: "Blue + Teal",
        presets: [
          { name: "Ocean", stops: ["#E0FBFC", "#98C1D9", "#3D5A80", "#2E4F6E", "#1B3A57", "#0B132B"] },
          { name: "Aurora", stops: ["#0B132B", "#1C2541", "#3A506B", "#5BC0BE", "#6FFFE9", "#E0FBFC"] },
          { name: "Sky", stops: ["#E0FBFC", "#C2E9F2", "#A0D2F3", "#7FBCE8", "#4F9DD9", "#2B7CBF"] },
          { name: "Azure", stops: ["#E6F4FF", "#CDE7FF", "#A7D1FF", "#7BB2FF", "#4C8DFF", "#2B5DFF"] },
          { name: "Denim", stops: ["#F0F4FF", "#C7D2FE", "#93A4FF", "#6366F1", "#4F46E5", "#312E81"] },
          { name: "Teal", stops: ["#E6FFFB", "#B2F5EA", "#81E6D9", "#4FD1C5", "#38B2AC", "#2C7A7B"] },
          { name: "Tide", stops: ["#E0FBFC", "#9AD1D4", "#5DB7C1", "#2D9CDB", "#247BA0", "#005073"] },
        ],
      },
      {
        name: "Purple",
        presets: [
          { name: "Iris", stops: ["#F5F3FF", "#DDD6FE", "#C4B5FD", "#A78BFA", "#8B5CF6", "#6D28D9"] },
          { name: "Amethyst", stops: ["#F8EDEB", "#E8DFF5", "#D0BCFF", "#B8B8FF", "#A0C4FF", "#7AA2F7"] },
          { name: "Plum", stops: ["#2D1E2F", "#4E2A4D", "#6B2F5F", "#8C3F7C", "#B24C9A", "#D66BA0"] },
          { name: "Lavender", stops: ["#F5F3FF", "#EDE9FE", "#DDD6FE", "#C4B5FD", "#A78BFA", "#7C3AED"] },
          { name: "Orchid", stops: ["#FDF4FF", "#F5D0FE", "#E879F9", "#C026D3", "#A21CAF", "#701A75"] },
          { name: "Indigo", stops: ["#EEF2FF", "#C7D2FE", "#A5B4FC", "#818CF8", "#6366F1", "#4338CA"] },
          { name: "Grape", stops: ["#1F1147", "#2B145E", "#3B1B8C", "#4C1D95", "#6D28D9", "#A855F7"] },
        ],
      },
      {
        name: "Spectrum",
        presets: [
          { name: "Tropics", stops: ["#00F5D4", "#00BBF9", "#4361EE", "#3A0CA3", "#7209B7", "#F72585"] },
          { name: "Retro", stops: ["#F9C74F", "#F9844A", "#F8961E", "#F3722C", "#F94144", "#90BE6D"] },
          { name: "Twilight", stops: ["#0B1021", "#1C2541", "#3A506B", "#5BC0BE", "#9EE493", "#F6F740"] },
          { name: "Nebula", stops: ["#1B1B3A", "#4A4E69", "#9A8C98", "#C9ADA7", "#F2E9E4", "#F72585"] },
          { name: "Aurora Boreal", stops: ["#001219", "#005F73", "#0A9396", "#94D2BD", "#E9D8A6", "#EE9B00"] },
          { name: "Spectra", stops: ["#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF", "#8B00FF"] },
          { name: "Rainbow", stops: ["#FF5F6D", "#FFC371", "#FDEB71", "#C0F2D8", "#8EC5FC", "#E0C3FC"] },
        ],
      },
    ],
    []
  );

  useEffect(() => {
    savePresetsToStorage(savedPresets);
  }, [savedPresets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("preset");
    if (!encoded) return;
    const decoded = decodePresetFromUrl(encoded);
    if (decoded) {
      setPendingPreset(decoded);
    }
  }, []);

  return (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-center px-6 pt-16 pb-16">
      <div className="w-full max-w-[1312px]">
        <InteractiveHeroBanner
          colorStops={normalizedStops}
          renderControls={(props) => (
            <ControlPanel
              {...props}
              colorStops={normalizedStops}
              setColorStops={setColorStops}
              selectedPreset={selectedPreset}
              setSelectedPreset={setSelectedPreset}
              savedPresets={savedPresets}
              setSavedPresets={setSavedPresets}
              pendingPreset={pendingPreset}
              clearPendingPreset={() => setPendingPreset(null)}
              onSyncBannerState={(controls, updateControl) => {
                setBannerControls(controls);
                setBannerUpdateControl(() => updateControl);
              }}
            />
          )}
        />
        <div
          className="mt-4 p-4 rounded-xl text-xs"
          style={{
            background: "rgba(15, 15, 15, 0.9)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  setColorStops([...normalizedStops].reverse());
                  setSelectedPreset("Custom");
                }}
                className="h-7 w-7 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[12px] uppercase tracking-wider transition-colors flex items-center justify-center"
                title="Reverse colors"
                aria-label="Reverse colors"
              >
                ↔
              </button>
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">Presets</span>
            </div>
            <div className="flex flex-col gap-3">
              {colorPresetGroups.map((group) => (
                <div key={group.name} className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">{group.name}</span>
                  {group.presets.map((preset) => {
                    const isSelected = selectedPreset === preset.name;
                    return (
                      <button
                        key={preset.name}
                        onClick={() => {
                          setColorStops(preset.stops);
                          setSelectedPreset(preset.name);
                        }}
                        className={`px-2 py-1 rounded-md text-[10px] uppercase tracking-wider transition-colors border ${
                          isSelected
                            ? "bg-neutral-700 text-neutral-100 border-neutral-500"
                            : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-transparent"
                        }`}
                      >
                        {preset.name}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">Colors</span>
            {normalizedStops.map((stop, index) => (
              <Popover
                key={`color-stop-${index}`}
                open={openPickerIndex === index}
                onOpenChange={(open) => setOpenPickerIndex(open ? index : null)}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md border border-white/10 bg-transparent px-2 py-1 hover:border-white/30"
                  >
                    <span
                      className="h-6 w-6 rounded border border-white/10"
                      style={{ backgroundColor: stop }}
                    />
                    <span className="text-[10px] text-neutral-400">{stop}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={8}
                  className="w-72 p-3"
                >
                  <div
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerMove={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                  >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-500">Picker</span>
                    <button
                      type="button"
                      onClick={() => setOpenPickerIndex(null)}
                      className="px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors"
                    >
                      Done
                    </button>
                  </div>
                  <ColorPickerGradient
                    value={stop}
                    idSuffix={`color-${index}`}
                    onChange={(nextColor) => {
                      const next = [...normalizedStops];
                      next[index] = nextColor;
                      setColorStops(next);
                      setSelectedPreset("Custom");
                    }}
                  />
                  </div>
                </PopoverContent>
              </Popover>
            ))}
            <button
              onClick={() => {
                setColorStops(DEFAULT_COLOR_STOPS);
                setSelectedPreset("Original");
              }}
              className="ml-auto px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors"
            >
              Reset Colors
            </button>
            </div>
          </div>
          {bannerControls && bannerUpdateControl && (
            <SavedPresetsPanel
              controls={bannerControls}
              colorStops={normalizedStops}
              updateControl={bannerUpdateControl}
              setColorStops={setColorStops}
              savedPresets={savedPresets}
              setSavedPresets={setSavedPresets}
              onSelectPresetName={setSelectedPreset}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;