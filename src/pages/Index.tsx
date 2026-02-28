import InteractiveHeroBanner, { ControlSlider, DEFAULT_COLOR_STOPS, type ControlPanelProps, type Controls } from "@/components/InteractiveHeroBanner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEffect, useMemo, useRef, useState } from "react";
import ColorPickerGradient from "@/components/ColorPickerGradient";
import { Trash } from "lucide-react";
import {
  decodePresetFromUrl,
  loadPresetsFromStorage,
  savePresetsToStorage,
  type BannerPreset,
} from "@/presets/presets";

const DEFAULT_COLOR_PRESET_NAME = "Rainbow";
const DEFAULT_COLOR_PRESET_STOPS = ["#FF5F6D", "#FFC371", "#FDEB71", "#C0F2D8", "#8EC5FC", "#E0C3FC"];
const MAX_SAVED_PRESETS = 25;
const DELETED_COLOR_PRESETS_STORAGE_KEY = "bubblebanner.deleted_color_presets.v1";

const FUN_COLOR_WORDS = [
  { name: "Cherry", range: [0, 18] },
  { name: "Sunset", range: [18, 45] },
  { name: "Citrus", range: [45, 70] },
  { name: "Lime", range: [70, 110] },
  { name: "Lagoon", range: [110, 160] },
  { name: "Aqua", range: [160, 200] },
  { name: "Sky", range: [200, 230] },
  { name: "Azure", range: [230, 255] },
  { name: "Iris", range: [255, 285] },
  { name: "Grape", range: [285, 315] },
  { name: "Rose", range: [315, 360] },
];
const FUN_NOUNS_DARK = ["Nebula", "Velvet", "Nocturne", "Shadow", "Orbit", "Drift", "Smoke", "Depth"];
const FUN_NOUNS_MID = ["Glow", "Bloom", "Mist", "Ripple", "Aura", "Haze", "Ember", "Tide"];
const FUN_NOUNS_BRIGHT = ["Lollipop", "Sorbet", "Fizz", "Spark", "Halo", "Spritz", "Pop", "Shine"];
const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const hexToRgb = (value: string) => {
  const hex = value.replace("#", "").trim();
  const normalized = hex.length === 3
    ? hex.split("").map((c) => c + c).join("")
    : hex;
  if (normalized.length !== 6) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
};

const rgbToHsl = (r: number, g: number, b: number) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
};

const getPaletteSignature = (stops: string[]) =>
  stops.map((stop) => stop.trim().toUpperCase()).join("|");

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
};

const getAverageHsl = (stops: string[]) => {
  let sumX = 0;
  let sumY = 0;
  let sumL = 0;
  let count = 0;
  stops.forEach((stop) => {
    const rgb = hexToRgb(stop);
    if (!rgb) return;
    const { h, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const rad = (h * Math.PI) / 180;
    sumX += Math.cos(rad);
    sumY += Math.sin(rad);
    sumL += l;
    count += 1;
  });
  if (count === 0) return { hue: 0, lightness: 0.5 };
  const avgHue = (Math.atan2(sumY / count, sumX / count) * 180) / Math.PI;
  const hue = (avgHue + 360) % 360;
  return { hue, lightness: sumL / count };
};

const getColorWord = (hue: number) => {
  const normalized = (hue + 360) % 360;
  const match = FUN_COLOR_WORDS.find(
    (entry) => normalized >= entry.range[0] && normalized < entry.range[1]
  );
  return match?.name ?? "Aurora";
};

const getNounForLightness = (lightness: number, hash: number) => {
  const normalized = clamp(lightness, 0, 1);
  const nouns =
    normalized < 0.4 ? FUN_NOUNS_DARK : normalized < 0.7 ? FUN_NOUNS_MID : FUN_NOUNS_BRIGHT;
  const index = Math.abs(hash) % nouns.length;
  return nouns[index];
};

const toRomanSuffix = (value: number) => {
  if (value <= 0) return "";
  if (value <= ROMAN_NUMERALS.length) return ROMAN_NUMERALS[value - 1];
  return `${value}`;
};

const ensureUniqueName = (baseName: string, existing: Set<string>) => {
  let name = baseName;
  let count = 1;
  while (existing.has(name.toLowerCase())) {
    count += 1;
    const suffix = toRomanSuffix(count);
    name = `${baseName} ${suffix}`;
  }
  existing.add(name.toLowerCase());
  return name;
};

const generatePresetName = (stops: string[]) => {
  const signature = getPaletteSignature(stops);
  const hash = hashString(signature);
  const { hue, lightness } = getAverageHsl(stops);
  const colorWord = getColorWord(hue);
  const noun = getNounForLightness(lightness, hash);
  return `${colorWord} ${noun}`;
};

type ControlPanelExtraProps = {
  colorStops: string[];
  setColorStops: (stops: string[]) => void;
  selectedPreset: string;
  setSelectedPreset: (name: string) => void;
  clearActiveSavedPreset: () => void;
  isColorsLocked: boolean;
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
  clearActiveSavedPreset,
  isColorsLocked,
  savedPresets,
  setSavedPresets,
  pendingPreset,
  clearPendingPreset,
  onSyncBannerState,
}: ControlPanelProps & ControlPanelExtraProps) => {
  useEffect(() => {
    onSyncBannerState(controls, updateControl);
  }, [controls, updateControl, onSyncBannerState]);

  const updateControlAndClearSaved = (key: keyof Controls, value: number) => {
    clearActiveSavedPreset();
    updateControl(key, value);
  };

  useEffect(() => {
    if (!pendingPreset) return;
    clearActiveSavedPreset();
    setColorStops(pendingPreset.colorStops);
    Object.entries(pendingPreset.controls).forEach(([key, value]) => {
      updateControl(key as keyof Controls, value as number);
    });
    setSelectedPreset(pendingPreset.name?.trim() || "Custom");
    clearPendingPreset();
  }, [
    pendingPreset,
    clearActiveSavedPreset,
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
      WebkitBackdropFilter: "blur(12px)",
      border: "1px solid rgba(255, 255, 255, 0.08)",
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
    }}
  >
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div className="py-1 text-[14px] uppercase tracking-wider text-neutral-300">Motion</div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            clearActiveSavedPreset();
            onReset();
          }}
          className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] uppercase tracking-wider transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
    <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Hover Controls */}
      <div className="w-full min-w-0 flex flex-col gap-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Hover</label>
        <div className="flex flex-col gap-1 items-start justify-start h-fit">
          <ControlSlider label="Strength" value={controls.hoverStrength} onChange={(v) => updateControlAndClearSaved("hoverStrength", v)} min={0} max={3} />
          <ControlSlider label="Radius" value={controls.hoverRadius} onChange={(v) => updateControlAndClearSaved("hoverRadius", v)} min={0.1} max={1} />
          <ControlSlider label="Spring" value={controls.spring} onChange={(v) => updateControlAndClearSaved("spring", v)} min={0.1} max={2} />
          <ControlSlider label="Damping" value={controls.damping} onChange={(v) => updateControlAndClearSaved("damping", v)} min={0.1} max={2} />
        </div>
      </div>

      {/* Shatter controls */}
      <div className="w-full min-w-0 flex flex-col gap-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Shatter</label>
        <div className="flex flex-col gap-1 items-start justify-start h-fit">
          <ControlSlider label="Spread" value={controls.shardSpread} onChange={(v) => updateControlAndClearSaved("shardSpread", v)} min={0.1} max={3} />
          <ControlSlider label="Travel" value={controls.explosionForce} onChange={(v) => updateControlAndClearSaved("explosionForce", v)} min={0.3} max={3} />
          <ControlSlider label="Spin" value={controls.explosionSpin} onChange={(v) => updateControlAndClearSaved("explosionSpin", v)} min={0} max={3} />
          <ControlSlider
            label="Duration"
            value={controls.explosionDurationMs}
            onChange={(v) => updateControlAndClearSaved("explosionDurationMs", v)}
            min={150}
            max={2000}
            step={50}
            formatValue={(v) => `${Math.round(v)}ms`}
          />
        </div>
      </div>

      {/* Reorg controls */}
      <div className="w-full min-w-0 flex flex-col gap-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Reorg</label>
        <div className="flex flex-col gap-1 items-start justify-start h-fit">
          <ControlSlider label="Delay" value={controls.settleTime} onChange={(v) => updateControlAndClearSaved("settleTime", v)} min={0} max={5} />
          <ControlSlider
            label="Float ms"
            value={controls.floatDurationMs}
            onChange={(v) => updateControlAndClearSaved("floatDurationMs", v)}
            min={200}
            max={2000}
            step={50}
            formatValue={(v) => `${Math.round(v)}ms`}
          />
          <ControlSlider label="Speed" value={controls.returnSpring} onChange={(v) => updateControlAndClearSaved("returnSpring", v)} min={0.5} max={5} />
          <ControlSlider label="Ease" value={controls.settleDamping} onChange={(v) => updateControlAndClearSaved("settleDamping", v)} min={0} max={2} />
        </div>
      </div>
    </div>
  </div>
);
};

const Index = () => {
  const [colorStops, setColorStops] = useState<string[]>(DEFAULT_COLOR_PRESET_STOPS);
  const [selectedPreset, setSelectedPreset] = useState<string>(DEFAULT_COLOR_PRESET_NAME);
  const [savedPresets, setSavedPresets] = useState<BannerPreset[]>(() => loadPresetsFromStorage());
  const [pendingPreset, setPendingPreset] = useState<BannerPreset | null>(null);
  const [bannerControls, setBannerControls] = useState<Controls | null>(null);
  const [bannerUpdateControl, setBannerUpdateControl] = useState<((key: keyof Controls, value: number) => void) | null>(null);
  const [openPickerIndex, setOpenPickerIndex] = useState<number | null>(null);
  const [activeSavedPresetId, setActiveSavedPresetId] = useState<string | null>(null);
  const didNormalizeSavedNames = useRef(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [deletedColorPresetNames, setDeletedColorPresetNames] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(DELETED_COLOR_PRESETS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
    } catch {
      return [];
    }
  });
  const normalizedStops = useMemo(
    () => colorStops.map((stop) => stop.trim().toUpperCase()),
    [colorStops]
  );
  const colorPresetGroups = useMemo(() => {
    const hidden = new Set(deletedColorPresetNames);
    const groups = [
      {
        name: "Neon",
        presets: [
          { name: "Glitch", stops: ["#FF0080", "#CC00FF", "#6600FF", "#0066FF", "#00CCFF", "#00FF9F"] },
          { name: "Laser", stops: ["#FF3864", "#FF6B00", "#FFDD00", "#00E5FF", "#4D00FF", "#FF00FF"] },
          { name: "Hologram", stops: ["#E040FB", "#7C4DFF", "#448AFF", "#00E5FF", "#69FF47", "#FFEE00"] },
          { name: "Circuit", stops: ["#00FF9F", "#00E5FF", "#0080FF", "#5500FF", "#AA00FF", "#FF0080"] },
          { name: "Plasma", stops: ["#FF4081", "#FF6D00", "#FFD600", "#76FF03", "#00E5FF", "#7C4DFF"] },
          { name: "Overload", stops: ["#FF006E", "#FF7600", "#FFCC00", "#00FF85", "#00B4D8", "#9B5DE5"] },
        ],
      },
      {
        name: "Synthwave",
        presets: [
          { name: "Outrun", stops: ["#F72585", "#B5179E", "#7209B7", "#3A0CA3", "#4361EE", "#4CC9F0"] },
          { name: "Vaporwave", stops: ["#FF6AD5", "#C774E8", "#AD8CFF", "#8795E8", "#94D0FF", "#9BFAFF"] },
          { name: "Miami", stops: ["#FF2A6D", "#FF5C8D", "#FF89B5", "#05D9E8", "#00B4D8", "#48CAE4"] },
          { name: "Cassette", stops: ["#FFBE0B", "#FB5607", "#FF006E", "#8338EC", "#3A86FF", "#06D6A0"] },
          { name: "Neon Noir", stops: ["#FF00FF", "#DD11EE", "#BB22DD", "#9933FF", "#5544FF", "#00AAFF"] },
          { name: "Synth", stops: ["#FFB700", "#FF6B6B", "#FF006E", "#9B5DE5", "#5E60CE", "#48CAE4"] },
        ],
      },
      {
        name: "Lo-Fi",
        presets: [
          { name: "Haze", stops: ["#FFD166", "#FF9E64", "#FF6E91", "#D490D4", "#8ABFFF", "#A5F3FC"] },
          { name: "Analog", stops: ["#FF9F43", "#EE5A24", "#C44569", "#9980FA", "#5F27CD", "#706FD3"] },
          { name: "Tokyo", stops: ["#FF6E9C", "#B97BFF", "#7289FF", "#60A0FF", "#4ECDC4", "#A0FFB5"] },
          { name: "Sunset Tape", stops: ["#FF6B6B", "#FE9C7F", "#FFEAA7", "#81ECEC", "#74B9FF", "#A29BFE"] },
          { name: "Bloom", stops: ["#FD79A8", "#E84393", "#A29BFE", "#6C5CE7", "#00CEC9", "#55EFC4"] },
        ],
      },
      {
        name: "Spectrum",
        presets: [
          { name: "Tropics", stops: ["#00F5D4", "#00BBF9", "#4361EE", "#3A0CA3", "#7209B7", "#F72585"] },
          { name: "Retro", stops: ["#F9C74F", "#F9844A", "#F8961E", "#F3722C", "#F94144", "#90BE6D"] },
          { name: "Twilight", stops: ["#0B1021", "#1C2541", "#3A506B", "#5BC0BE", "#9EE493", "#F6F740"] },
          { name: "Nebula", stops: DEFAULT_COLOR_PRESET_STOPS },
          { name: "Aurora Boreal", stops: ["#001219", "#005F73", "#0A9396", "#94D2BD", "#E9D8A6", "#EE9B00"] },
          { name: "Spectra", stops: ["#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF", "#8B00FF"] },
          { name: "Rainbow", stops: ["#FF5F6D", "#FFC371", "#FDEB71", "#C0F2D8", "#8EC5FC", "#E0C3FC"] },
        ],
      },
    ];
    return groups
      .map((group) => ({
        ...group,
        presets: group.presets.filter((preset) => !hidden.has(preset.name)),
      }))
      .filter((group) => group.presets.length > 0);
  }, [deletedColorPresetNames]);

  useEffect(() => {
    savePresetsToStorage(savedPresets);
  }, [savedPresets]);

  useEffect(() => {
    if (didNormalizeSavedNames.current) return;
    didNormalizeSavedNames.current = true;
    setSavedPresets((prev) => {
      if (prev.length === 0) return prev;
      const used = new Set<string>();
      let changed = false;
      const next = prev.map((preset) => {
        const existingName = preset.name?.trim() || "";
        const baseName = existingName || generatePresetName(preset.colorStops);
        const uniqueName = ensureUniqueName(baseName, used);
        if (uniqueName !== existingName) {
          changed = true;
          return { ...preset, name: uniqueName };
        }
        return preset;
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        DELETED_COLOR_PRESETS_STORAGE_KEY,
        JSON.stringify(deletedColorPresetNames)
      );
    } catch {
      // Ignore storage failures
    }
  }, [deletedColorPresetNames]);

  const handleSavePreset = () => {
    if (savedPresets.length >= MAX_SAVED_PRESETS) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const createdAt = Date.now();
    setSavedPresets((prev) => {
      const baseName = generatePresetName(normalizedStops);
      const existing = new Set(
        prev.map((p) => (p.name?.trim() || "").toLowerCase()).filter(Boolean)
      );
      const dedupedName = ensureUniqueName(baseName, existing);

      const newPreset: BannerPreset = {
        id,
        name: dedupedName,
        createdAt,
        controls: bannerControls ? { ...bannerControls } : ({} as Controls),
        colorStops: [...normalizedStops],
      };

      return [newPreset, ...prev].slice(0, MAX_SAVED_PRESETS);
    });
    setActiveSavedPresetId(id);
  };

  const applySavedPreset = (preset: BannerPreset) => {
    if (!bannerUpdateControl) return;
    setActiveSavedPresetId(preset.id);
    setColorStops(preset.colorStops);
    Object.entries(preset.controls).forEach(([key, value]) => {
      bannerUpdateControl(key as keyof Controls, value as number);
    });
    setSelectedPreset("Custom");
  };

  const applyBuiltInPreset = (name: string, stops: string[]) => {
    setActiveSavedPresetId(null);
    setColorStops(stops);
    setSelectedPreset(name);
  };

  const findBuiltInPreset = (name: string) => {
    for (const group of colorPresetGroups) {
      for (const preset of group.presets) {
        if (preset.name === name) return { group, preset };
      }
    }
    return null;
  };

  const handleDeleteSelectedPreset = () => {
    // 1) If a saved preset is active, delete that (existing behavior)
    if (activeSavedPresetId) {
      const idx = savedPresets.findIndex((p) => p.id === activeSavedPresetId);
      if (idx === -1) return;
      const nextPresets = savedPresets.filter((p) => p.id !== activeSavedPresetId);
      setSavedPresets(nextPresets);
      const nextSelected = nextPresets[idx] ?? nextPresets[idx - 1] ?? null;
      if (!nextSelected) {
        setActiveSavedPresetId(null);
        return;
      }
      applySavedPreset(nextSelected);
      return;
    }

    // 2) Otherwise, delete the selected built-in preset (persisted via localStorage)
    if (selectedPreset === "Custom") return;
    const builtIn = findBuiltInPreset(selectedPreset);
    if (!builtIn) return;

    // Determine "next to the right (or left)" within the same group first,
    // then fall back to the next/prev group if the group becomes empty.
    const groupName = builtIn.group.name;
    const group = colorPresetGroups.find((g) => g.name === groupName);
    if (!group) return;
    const idx = group.presets.findIndex((p) => p.name === selectedPreset);
    if (idx === -1) return;

    setDeletedColorPresetNames((prev) =>
      prev.includes(selectedPreset) ? prev : [...prev, selectedPreset]
    );

    const nextInGroup =
      group.presets[idx + 1] ?? group.presets[idx - 1] ?? null;
    if (nextInGroup) {
      applyBuiltInPreset(nextInGroup.name, nextInGroup.stops);
      return;
    }

    // Group would become empty; pick first preset of next group to the right,
    // otherwise last preset of previous group.
    const groupIndex = colorPresetGroups.findIndex((g) => g.name === groupName);
    const nextGroup = colorPresetGroups[groupIndex + 1];
    if (nextGroup && nextGroup.presets.length > 0) {
      const nextPreset = nextGroup.presets[0];
      applyBuiltInPreset(nextPreset.name, nextPreset.stops);
      return;
    }
    const prevGroup = colorPresetGroups[groupIndex - 1];
    if (prevGroup && prevGroup.presets.length > 0) {
      const nextPreset = prevGroup.presets[prevGroup.presets.length - 1];
      applyBuiltInPreset(nextPreset.name, nextPreset.stops);
      return;
    }

    // No built-ins left
    setSelectedPreset("Custom");
  };

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

  // If the currently selected built-in preset was deleted, fall back to the first available.
  useEffect(() => {
    if (activeSavedPresetId) return;
    if (selectedPreset === "Custom") return;
    const exists = findBuiltInPreset(selectedPreset);
    if (exists) return;
    const first = colorPresetGroups[0]?.presets?.[0];
    if (!first) return;
    applyBuiltInPreset(first.name, first.stops);
  }, [activeSavedPresetId, selectedPreset, colorPresetGroups]);

  return (
    <div className="min-h-screen bg-transparent flex flex-col items-center justify-center px-6 pt-16 pb-16">
      <div className="w-full max-w-[1312px]">
        <InteractiveHeroBanner
          colorStops={normalizedStops}
          persistControls={false}
          onFirstInteraction={() => {
            setHasInteracted(true);
          }}
          onResetComplete={() => {
            setHasInteracted(false);
            setOpenPickerIndex(null);
          }}
          renderControls={(props) => (
            <ControlPanel
              {...props}
              colorStops={normalizedStops}
              setColorStops={setColorStops}
              selectedPreset={selectedPreset}
              setSelectedPreset={setSelectedPreset}
              clearActiveSavedPreset={() => setActiveSavedPresetId(null)}
              isColorsLocked={hasInteracted}
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
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center justify-between gap-10 py-1">
              <div className="flex items-center gap-3">
                <span className="py-1 text-[14px] uppercase tracking-wider text-neutral-300">Colors</span>
                {hasInteracted && (
                  <span className="text-[10px] uppercase tracking-wider text-neutral-600">
                    Locked after interaction
                  </span>
                )}
              </div>
              <div className={`${hasInteracted ? "opacity-50 pointer-events-none" : ""} flex items-center gap-2`}>
                <button
                  onClick={() => {
                    setActiveSavedPresetId(null);
                    setColorStops([...normalizedStops].reverse());
                    setSelectedPreset("Custom");
                  }}
                  disabled={hasInteracted}
                  className={`h-7 w-7 rounded-md text-[12px] uppercase tracking-wider transition-colors flex items-center justify-center ${
                    hasInteracted
                      ? "bg-neutral-800 text-neutral-600 cursor-not-allowed"
                      : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                  }`}
                  title="Reverse colors"
                  aria-label="Reverse colors"
                >
                  ↔
                </button>
                <button
                  onClick={handleSavePreset}
                  disabled={hasInteracted || savedPresets.length >= MAX_SAVED_PRESETS || !bannerControls}
                  className={`px-2 py-1 rounded-md text-[10px] uppercase tracking-wider transition-colors ${
                    hasInteracted || savedPresets.length >= MAX_SAVED_PRESETS || !bannerControls
                      ? "bg-neutral-800 text-neutral-600 cursor-not-allowed"
                      : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                  }`}
                >
                  Save
                </button>
                <button
                  onClick={handleDeleteSelectedPreset}
                  disabled={
                    hasInteracted ||
                    (activeSavedPresetId === null &&
                      (selectedPreset === "Custom" || !findBuiltInPreset(selectedPreset))) ||
                    (activeSavedPresetId !== null && savedPresets.length === 0)
                  }
                  className={`h-7 w-7 rounded-md text-[12px] uppercase tracking-wider transition-colors flex items-center justify-center ${
                    hasInteracted ||
                    (activeSavedPresetId === null &&
                      (selectedPreset === "Custom" || !findBuiltInPreset(selectedPreset))) ||
                    (activeSavedPresetId !== null && savedPresets.length === 0)
                      ? "bg-neutral-800 text-neutral-600 cursor-not-allowed"
                      : "bg-neutral-800 hover:bg-neutral-700 text-white"
                  }`}
                  title="Delete selected preset"
                  aria-label="Delete selected preset"
                >
                  <Trash size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div
              className={`${hasInteracted ? "opacity-50 pointer-events-none" : ""}`}
              aria-disabled={hasInteracted}
            >
              <div className="flex flex-col gap-3">
              <div className="flex flex-nowrap items-center gap-3 pt-1 pb-3">
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
                        setActiveSavedPresetId(null);
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
              </div>
              {savedPresets.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-block w-20 text-[10px] uppercase tracking-wider text-neutral-500">Saved</span>
                  {savedPresets.map((preset) => {
                    const isSelected = activeSavedPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => {
                          applySavedPreset(preset);
                        }}
                        title={preset.name || "Saved preset"}
                        className={`px-2 py-1 rounded-md text-[10px] uppercase tracking-wider transition-colors border inline-flex items-center gap-2 ${
                          isSelected
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
                          <span>{preset.name || "Saved"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {colorPresetGroups.map((group) => (
                <div key={group.name} className="flex flex-wrap items-center gap-2">
                  <span className="inline-block w-20 text-[10px] uppercase tracking-wider text-neutral-500">{group.name}</span>
                  {group.presets.map((preset) => {
                    const isSelected = selectedPreset === preset.name;
                    return (
                      <button
                        key={preset.name}
                        onClick={() => {
                          setActiveSavedPresetId(null);
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
          </div>
        </div>
      </div>
    </div>
    </div>
  );
};

export default Index;