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

const DEFAULT_COLOR_PRESET_NAME = "Copper";
const DEFAULT_COLOR_PRESET_STOPS = ["#FFF1E6", "#FFD7BA", "#FFB48F", "#F28F3B", "#C8553D", "#6F1D1B"];
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
    <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          <ControlSlider
            label="Stagger"
            value={controls.fractureStaggerMsMax}
            onChange={(v) => updateControlAndClearSaved("fractureStaggerMsMax", v)}
            min={0}
            max={150}
            step={10}
            formatValue={(v) => `${Math.round(v)}ms`}
          />
        </div>
      </div>

      {/* Wall bounce controls */}
      <div className="w-full min-w-0 flex flex-col gap-1">
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Wall Bounce</label>
        <div className="flex flex-col gap-1 items-start justify-start h-fit">
          <ControlSlider label="Bounce" value={controls.wallRestitution} onChange={(v) => updateControlAndClearSaved("wallRestitution", v)} min={0} max={1} step={0.05} />
          <ControlSlider label="Friction" value={controls.wallFriction} onChange={(v) => updateControlAndClearSaved("wallFriction", v)} min={0} max={0.6} step={0.02} />
          <ControlSlider label="Spin" value={controls.wallSpinDamping} onChange={(v) => updateControlAndClearSaved("wallSpinDamping", v)} min={0} max={0.6} step={0.02} />
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