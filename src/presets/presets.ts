import type { Controls } from "@/components/InteractiveHeroBanner";

export const PRESETS_STORAGE_KEY = "bubblebanner_presets_v1";

export type BannerPreset = {
  id: string;
  name?: string;
  createdAt: number;
  controls: Controls;
  colorStops: string[];
};

const safeBase64Encode = (value: string) =>
  btoa(unescape(encodeURIComponent(value)));

const safeBase64Decode = (value: string) =>
  decodeURIComponent(escape(atob(value)));

export const encodePresetForUrl = (preset: BannerPreset) => {
  const json = JSON.stringify(preset);
  return encodeURIComponent(safeBase64Encode(json));
};

export const decodePresetFromUrl = (encoded: string): BannerPreset | null => {
  try {
    const base64 = decodeURIComponent(encoded);
    const json = safeBase64Decode(base64);
    const parsed = JSON.parse(json) as BannerPreset;
    if (!isValidPreset(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const loadPresetsFromStorage = (): BannerPreset[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BannerPreset[];
    return parsed.filter(isValidPreset);
  } catch {
    return [];
  }
};

export const savePresetsToStorage = (presets: BannerPreset[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
};

const isValidPreset = (value: BannerPreset | null | undefined): value is BannerPreset => {
  if (!value) return false;
  if (!Array.isArray(value.colorStops)) return false;
  if (!value.controls || typeof value.controls !== "object") return false;
  return typeof value.id === "string" && typeof value.createdAt === "number";
};
