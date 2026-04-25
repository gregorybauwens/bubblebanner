import InteractiveHeroBanner, { ControlSlider, DEFAULT_COLOR_STOPS, DEFAULT_CONTROLS, type ControlPanelProps, type Controls } from "@/components/InteractiveHeroBanner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEffect, useMemo, useRef, useState } from "react";
import ColorPickerGradient from "@/components/ColorPickerGradient";
import { ChevronDown, Trash, Save, RotateCcw, Sun, Moon } from "lucide-react";
import {
  decodePresetFromUrl,
  loadPresetsFromStorage,
  savePresetsToStorage,
  type BannerPreset,
} from "@/presets/presets";

const DEFAULT_COLOR_PRESET_NAME = "Haze";
const DEFAULT_COLOR_PRESET_STOPS = ["#FF5F6D", "#FFC371", "#FDEB71", "#C0F2D8", "#8EC5FC", "#E0C3FC"];
const DEFAULT_HAZE_STOPS = ["#FFD166", "#FF9E64", "#FF6E91", "#D490D4", "#8ABFFF", "#A5F3FC"];
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
  onSyncReset: (resetFn: () => void) => void;
  onReverseColors: () => void;
  onSavePreset: () => void;
  onDeletePreset: () => void;
  isSaveDisabled: boolean;
  isDeleteDisabled: boolean;
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
  onSyncReset,
  onReverseColors,
  onSavePreset,
  onDeletePreset,
  isSaveDisabled,
  isDeleteDisabled,
}: ControlPanelProps & ControlPanelExtraProps) => {
  const [isMotionOpen, setIsMotionOpen] = useState(false);

  useEffect(() => {
    onSyncBannerState(controls, updateControl);
  }, [controls, updateControl, onSyncBannerState]);

  useEffect(() => {
    onSyncReset(onReset);
  }, [onReset, onSyncReset]);

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
  <>
    <div className="mt-8 mb-4 flex items-center justify-end gap-2">
      <div className={`${isColorsLocked ? "opacity-50 pointer-events-none" : ""} flex items-center gap-2`}>
        <button
          onClick={onReverseColors}
          disabled={isColorsLocked}
          className={`h-8 w-8 rounded-lg transition-colors flex items-center justify-center ${
            isColorsLocked
              ? "bg-surface text-muted-foreground/50 cursor-not-allowed"
              : "bg-surface hover:bg-surface-hover text-surface-foreground"
          }`}
          title="Reverse colors"
          aria-label="Reverse colors"
        >
          <span className="text-[13px]">↔</span>
        </button>
        <button
          onClick={onSavePreset}
          disabled={isSaveDisabled}
          className={`h-8 w-8 rounded-lg transition-colors flex items-center justify-center ${
            isSaveDisabled
              ? "bg-surface text-muted-foreground/50 cursor-not-allowed"
              : "bg-surface hover:bg-surface-hover text-surface-foreground"
          }`}
          title="Save preset"
          aria-label="Save preset"
        >
          <Save size={14} aria-hidden="true" />
        </button>
        <button
          onClick={onDeletePreset}
          disabled={isDeleteDisabled}
          className={`h-8 w-8 rounded-lg transition-colors flex items-center justify-center ${
            isDeleteDisabled
              ? "bg-surface text-muted-foreground/50 cursor-not-allowed"
              : "bg-surface hover:bg-surface-hover text-surface-foreground"
          }`}
          title="Delete selected preset"
          aria-label="Delete selected preset"
        >
          <Trash size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="w-px h-5 bg-border" />
      <button
        onClick={() => {
          clearActiveSavedPreset();
          onReset();
        }}
        className="h-8 px-3 rounded-lg bg-surface-hover hover:bg-surface-active text-foreground text-[10px] uppercase tracking-wider transition-colors flex items-center gap-1.5"
      >
        <RotateCcw size={12} aria-hidden="true" />
        Reset
      </button>
    </div>
  <div
    className="mt-0 p-4 rounded-xl text-xs"
    style={{
      background: "hsl(var(--panel-bg))",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      border: "1px solid hsl(var(--panel-border))",
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
    }}
  >
    <button
      type="button"
      onClick={() => setIsMotionOpen((o) => !o)}
      className="w-full flex items-center justify-between mb-2 group"
    >
      <div className="py-1 text-[14px] uppercase tracking-wider text-foreground/80">Motion</div>
      <ChevronDown
        size={16}
        className="text-muted-foreground group-hover:text-foreground transition-all duration-300"
        style={{ transform: isMotionOpen ? "rotate(180deg)" : "rotate(0deg)" }}
      />
    </button>
    <div
      style={{
        display: "grid",
        gridTemplateRows: isMotionOpen ? "1fr" : "0fr",
        transition: "grid-template-rows 350ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <div style={{ overflow: "hidden" }}>
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 pb-1">
          {/* Hover Controls */}
          <div className="w-full min-w-0 flex flex-col gap-1">
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Hover</label>
            <div className="flex flex-col gap-1 items-start justify-start h-fit">
              <ControlSlider label="Strength" value={controls.hoverStrength} onChange={(v) => updateControlAndClearSaved("hoverStrength", v)} min={0} max={3} />
              <ControlSlider label="Radius" value={controls.hoverRadius} onChange={(v) => updateControlAndClearSaved("hoverRadius", v)} min={0.1} max={1} />
              <ControlSlider label="Spring" value={controls.spring} onChange={(v) => updateControlAndClearSaved("spring", v)} min={0.1} max={2} />
              <ControlSlider label="Damping" value={controls.damping} onChange={(v) => updateControlAndClearSaved("damping", v)} min={0.1} max={2} />
            </div>
          </div>

          {/* Shatter controls */}
          <div className="w-full min-w-0 flex flex-col gap-1">
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Shatter</label>
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
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">Reorg</label>
              <button
                onClick={() => {
                  const next = controls.disableReorg < 0.5 ? 1 : 0;
                  updateControlAndClearSaved("disableReorg", next);
                }}
                className={`relative w-8 h-[18px] rounded-full transition-colors ${
                  controls.disableReorg < 0.5
                    ? "bg-muted-foreground"
                    : "bg-muted"
                }`}
                title={controls.disableReorg < 0.5 ? "Reorg enabled" : "Reorg disabled"}
                aria-label="Toggle reorg"
              >
                <span
                  className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all"
                  style={{ left: controls.disableReorg < 0.5 ? 14 : 2 }}
                />
              </button>
            </div>
            <div className={`flex flex-col gap-1 items-start justify-start h-fit transition-opacity ${controls.disableReorg >= 0.5 ? "opacity-30 pointer-events-none" : ""}`}>
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
    </div>
  </div>
  </>
);
};

const THEME_STORAGE_KEY = "bubblebanner.theme";

const Index = () => {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(THEME_STORAGE_KEY) !== "light";
  });
  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.classList.toggle("light", !next);
    localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
  };
  const [colorStops, setColorStops] = useState<string[]>(DEFAULT_HAZE_STOPS);
  const [selectedPreset, setSelectedPreset] = useState<string>(DEFAULT_COLOR_PRESET_NAME);
  const [isColorsOpen, setIsColorsOpen] = useState(true);
  const [savedPresets, setSavedPresets] = useState<BannerPreset[]>(() => loadPresetsFromStorage());
  const [pendingPreset, setPendingPreset] = useState<BannerPreset | null>(null);
  const [bannerControls, setBannerControls] = useState<Controls | null>(null);
  const [bannerReset, setBannerReset] = useState<(() => void) | null>(null);
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
        name: "Soft",
        presets: [
          { name: "Haze",      stops: ["#FFD166", "#FF9E64", "#FF6E91", "#D490D4", "#8ABFFF", "#A5F3FC"] },
          { name: "Vaporwave", stops: ["#FF6AD5", "#C774E8", "#AD8CFF", "#8795E8", "#94D0FF", "#9BFAFF"] },
          { name: "Dusk",      stops: ["#112136", "#2D3954", "#4F4F76", "#767D9C", "#A198B2", "#C5B6CB"] },
          { name: "Bloom",     stops: ["#FD79A8", "#E84393", "#A29BFE", "#6C5CE7", "#00CEC9", "#55EFC4"] },
          { name: "Vapour",    stops: ["#844C3C", "#F7CCC0", "#E7D2CD", "#FCFEFF", "#91C4EE", "#FCFEFF"] },
          { name: "Glacier",   stops: ["#3C7A5D", "#C0F7D9", "#DBEDE3", "#D5CBCA", "#FFFFFE", "#FFFFFE"] },
          { name: "Linen",     stops: ["#4F4879", "#C5C0F7", "#C7C6D3", "#BCAF73", "#FFFAE4", "#FFFCEB"] },
          { name: "Petal",     stops: ["#76486C", "#F7C0E9", "#DFCED9", "#B7C186", "#FAFEEB", "#F9FFE2"] },
        ],
      },
      {
        name: "Vivid",
        presets: [
          { name: "Miami",     stops: ["#FF2A6D", "#FF5C8D", "#FF89B5", "#05D9E8", "#00B4D8", "#48CAE4"] },
          { name: "Tokyo",     stops: ["#FF6E9C", "#B97BFF", "#7289FF", "#60A0FF", "#4ECDC4", "#A0FFB5"] },
          { name: "Flare",     stops: ["#2D0059", "#7B0080", "#CC0044", "#FF2200", "#FF7700", "#FFCC99"] },
          { name: "Rosé",      stops: ["#5D0041", "#8A144F", "#C01C3F", "#E06A87", "#F99684", "#FFC6AA"] },
          { name: "Twilight",  stops: ["#0B1021", "#1C2541", "#3A506B", "#5BC0BE", "#9EE493", "#F6F740"] },
          { name: "Frostbite", stops: ["#360004", "#BF4A4A", "#B56F6B", "#005954", "#00C7BE", "#A2FFF6"] },
          { name: "Ember",     stops: ["#4A0001", "#DC0E0E", "#B89D99", "#004344", "#00A5B4", "#8BEFFD"] },
          { name: "Copper",    stops: ["#2F1100", "#EE8B44", "#E1AA87", "#77A6D2", "#307FC0", "#0F3E61"] },
          { name: "Jungle",    stops: ["#0A621A", "#44EE5B", "#BBCFBB", "#FF8CD1", "#FFF1F8", "#85516E"] },
          { name: "Gilded",    stops: ["#2B0027", "#C544B6", "#9E7096", "#E0B400", "#FFF6DE", "#7D6930"] },
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
    // Reset motion controls to defaults for every built-in color preset
    if (bannerUpdateControl) {
      Object.entries(DEFAULT_CONTROLS).forEach(([key, value]) => {
        bannerUpdateControl(key as keyof Controls, value as number);
      });
    }
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
      <button
        onClick={toggleTheme}
        className="fixed top-4 right-4 z-50 h-9 w-9 rounded-full bg-surface hover:bg-surface-hover text-surface-foreground transition-colors flex items-center justify-center shadow-md border border-border"
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        aria-label="Toggle theme"
      >
        {isDark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
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
              onSyncReset={(resetFn) => setBannerReset(() => resetFn)}
              onReverseColors={() => {
                setActiveSavedPresetId(null);
                setColorStops([...normalizedStops].reverse());
                setSelectedPreset("Custom");
              }}
              onSavePreset={handleSavePreset}
              onDeletePreset={handleDeleteSelectedPreset}
              isSaveDisabled={hasInteracted || savedPresets.length >= MAX_SAVED_PRESETS || !bannerControls}
              isDeleteDisabled={
                hasInteracted ||
                (activeSavedPresetId === null &&
                  (selectedPreset === "Custom" || !findBuiltInPreset(selectedPreset))) ||
                (activeSavedPresetId !== null && savedPresets.length === 0)
              }
            />
          )}
        />
        <div
          className="mt-4 p-4 rounded-xl text-xs"
          style={{
            background: "hsl(var(--panel-bg))",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid hsl(var(--panel-border))",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
          }}
        >
          <div className="flex flex-col gap-3 py-2">
            <button
              type="button"
              onClick={() => setIsColorsOpen((o) => !o)}
              className="w-full flex items-center justify-between mb-2 group"
            >
              <div className="py-1 text-[14px] uppercase tracking-wider text-foreground/80">Colors</div>
              <ChevronDown
                size={16}
                className="text-muted-foreground group-hover:text-foreground transition-all duration-300"
                style={{ transform: isColorsOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            </button>
            <div
              style={{
                display: "grid",
                gridTemplateRows: isColorsOpen ? "1fr" : "0fr",
                transition: "grid-template-rows 350ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
            <div style={{ overflow: "hidden" }}>
            <div className="relative">
            <div
              className={`transition-all duration-300 ${hasInteracted ? "pointer-events-none" : ""}`}
              style={hasInteracted ? { filter: "blur(4px)", opacity: 0.4 } : undefined}
              aria-disabled={hasInteracted}
            >
              <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3 pt-1 pb-3">
              {normalizedStops.map((stop, index) => (
                <Popover
                  key={`color-stop-${index}`}
                  open={openPickerIndex === index}
                  onOpenChange={(open) => setOpenPickerIndex(open ? index : null)}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-md border border-border bg-transparent px-2 py-1 hover:border-foreground/30"
                    >
                      <span
                        className="h-6 w-6 rounded border border-border"
                        style={{ backgroundColor: stop }}
                      />
                      <span className="text-[10px] text-muted-foreground">{stop}</span>
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
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Picker</span>
                      <button
                        type="button"
                        onClick={() => setOpenPickerIndex(null)}
                        className="px-2 py-1 rounded-md bg-surface hover:bg-surface-hover text-surface-foreground text-[10px] uppercase tracking-wider transition-colors"
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
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Saved</span>
                  <div className="grid gap-2 p-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}>
                  {savedPresets.map((preset) => {
                    const isSelected = activeSavedPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => {
                          applySavedPreset(preset);
                        }}
                        title={preset.name || "Saved preset"}
                        className={`group rounded-lg overflow-hidden transition-all ${
                          isSelected
                            ? "ring-2 ring-foreground/60 ring-offset-1 ring-offset-background"
                            : "ring-1 ring-foreground/10 hover:ring-foreground/30"
                        }`}
                      >
                        <div className="flex w-full h-7">
                          {(preset.colorStops || []).map((c, i) => (
                            <div key={`${preset.id}-s-${i}`} className="flex-1 h-full" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <div className="px-1.5 py-1 bg-card/80 text-[9px] text-muted-foreground group-hover:text-foreground truncate text-center uppercase tracking-wider transition-colors">
                          {preset.name || "Saved"}
                        </div>
                      </button>
                    );
                  })}
                  </div>
                </div>
              )}
              {colorPresetGroups.map((group) => (
                <div key={group.name} className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{group.name}</span>
                  <div className="grid gap-2 p-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}>
                  {group.presets.map((preset) => {
                    const isSelected = activeSavedPresetId === null && selectedPreset === preset.name;
                    return (
                      <button
                        key={preset.name}
                        onClick={() => {
                          setActiveSavedPresetId(null);
                          setColorStops(preset.stops);
                          setSelectedPreset(preset.name);
                        }}
                        className={`group rounded-lg overflow-hidden transition-all ${
                          isSelected
                            ? "ring-2 ring-foreground/60 ring-offset-1 ring-offset-background"
                            : "ring-1 ring-foreground/10 hover:ring-foreground/30"
                        }`}
                      >
                        <div className="flex w-full h-7">
                          {preset.stops.map((c, i) => (
                            <div key={`${preset.name}-s-${i}`} className="flex-1 h-full" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <div className="px-1.5 py-1 bg-card/80 text-[9px] text-muted-foreground group-hover:text-foreground truncate text-center uppercase tracking-wider transition-colors">
                          {preset.name}
                        </div>
                      </button>
                    );
                  })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {hasInteracted && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <button
                onClick={() => {
                  setActiveSavedPresetId(null);
                  bannerReset?.();
                }}
                className="px-4 py-2 rounded-full bg-surface/90 border border-foreground/20 text-foreground text-[11px] uppercase tracking-wider backdrop-blur-sm hover:bg-surface-hover/90 hover:border-foreground/40 transition-all shadow-lg"
              >
                Reset to edit colors
              </button>
            </div>
          )}
            </div>
            </div>
            </div>
        </div>
      </div>
    </div>
    </div>
  );
};

export default Index;