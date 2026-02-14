import type { AmountPreset, SlippageMode } from "./SwapSettings.svelte";

const SWAP_SLIPPAGE_STORAGE_KEY = "intear-dex-slippage";
const AMOUNT_PRESETS_STORAGE_KEY = "intear-dex-amount-presets";

export const DEFAULT_SWAP_SETTINGS_CONFIG: { mode: SlippageMode; value: number } = {
  mode: "auto",
  value: 0,
};

export const DEFAULT_AMOUNT_PRESETS: AmountPreset[] = [
  { type: "percent", value: 25 },
  { type: "percent", value: 50 },
  { type: "percent", value: 80 },
  { type: "percent", value: 100 },
  { type: "dollar", value: 10 },
  { type: "dollar", value: 100 },
];

function clonePresets(presets: AmountPreset[]): AmountPreset[] {
  return presets.map((preset) => ({ ...preset }));
}

function isValidSlippageMode(value: unknown): value is SlippageMode {
  return value === "auto" || value === "fixed";
}

function isValidPreset(value: unknown): value is AmountPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as { type?: unknown; value?: unknown };
  return (
    (preset.type === "percent" || preset.type === "dollar") &&
    typeof preset.value === "number" &&
    Number.isFinite(preset.value)
  );
}

export function loadSwapSettingsConfig(): { mode: SlippageMode; value: number } {
  try {
    const saved = localStorage.getItem(SWAP_SLIPPAGE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { mode?: unknown; value?: unknown };
      if (
        isValidSlippageMode(parsed.mode) &&
        typeof parsed.value === "number" &&
        Number.isFinite(parsed.value)
      ) {
        return { mode: parsed.mode, value: parsed.value };
      }
    }
  } catch {}

  return { ...DEFAULT_SWAP_SETTINGS_CONFIG };
}

export function saveSwapSettingsConfig(mode: SlippageMode, value: number): void {
  try {
    localStorage.setItem(
      SWAP_SLIPPAGE_STORAGE_KEY,
      JSON.stringify({ mode, value }),
    );
  } catch {}
}

export function loadAmountPresetsConfig(
  fallbackPresets: AmountPreset[] = DEFAULT_AMOUNT_PRESETS,
): { visible: boolean; presets: AmountPreset[] } {
  try {
    const saved = localStorage.getItem(AMOUNT_PRESETS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as {
        visible?: unknown;
        presets?: unknown;
      };
      if (
        typeof parsed.visible === "boolean" &&
        Array.isArray(parsed.presets) &&
        parsed.presets.every(isValidPreset)
      ) {
        return { visible: parsed.visible, presets: clonePresets(parsed.presets) };
      }
    }
  } catch {}

  return { visible: true, presets: clonePresets(fallbackPresets) };
}

export function saveAmountPresetsConfig(
  visible: boolean,
  presets: AmountPreset[],
): void {
  try {
    localStorage.setItem(
      AMOUNT_PRESETS_STORAGE_KEY,
      JSON.stringify({ visible, presets }),
    );
  } catch {}
}
