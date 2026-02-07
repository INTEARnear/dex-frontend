<script lang="ts">
  export type SlippageMode = "auto" | "fixed";
  export interface AmountPreset {
    type: "percent" | "dollar";
    value: number;
  }

  interface Props {
    mode: SlippageMode;
    value: number; // human readable percentage, e.g. 0.5 for 0.5%
    onchange: (mode: SlippageMode, value: number) => void;
    presetsVisible: boolean;
    presets: AmountPreset[];
    onPresetsChange: (visible: boolean, presets: AmountPreset[]) => void;
  }

  let {
    mode,
    value,
    onchange,
    presetsVisible,
    presets,
    onPresetsChange,
  }: Props = $props();

  const PRESETS = [0.1, 0.5, 1, 5];

  let customText = $state("");
  let customDirty = $state(false);

  // Sync custom text from external prop changes (e.g. initial load from localStorage)
  $effect(() => {
    if (!customDirty && mode === "fixed" && !PRESETS.includes(value)) {
      customText = String(value);
    }
  });

  const isCustomActive = $derived(customText.length > 0);

  function selectAuto() {
    customText = "";
    customDirty = false;
    onchange("auto", 0);
  }

  function selectPreset(preset: number) {
    customText = "";
    customDirty = false;
    onchange("fixed", preset);
  }

  function handleCustomInput(e: Event) {
    const input = e.target as HTMLInputElement;
    let text = input.value;

    // Allow only digits and a single decimal point
    text = text.replace(/[^\d.]/g, "");
    const dotIndex = text.indexOf(".");
    if (dotIndex !== -1) {
      text =
        text.slice(0, dotIndex + 1) +
        text.slice(dotIndex + 1).replace(/\./g, "");
    }

    if (text !== input.value) {
      input.value = text;
    }

    customText = text;
    customDirty = true;

    const num = parseFloat(text);
    if (text !== "" && !isNaN(num) && num >= 0 && num <= 100) {
      onchange("fixed", num);
    }
  }

  // --- Amount preset editing ---
  function handlePresetValueInput(index: number, e: Event) {
    const input = e.target as HTMLInputElement;
    let text = input.value.replace(/[^\d]/g, "");
    if (text !== input.value) input.value = text;
    const num = parseInt(text, 10);
    if (!isNaN(num) && num >= 1) {
      const maxVal = presets[index].type === "percent" ? 100 : 100000;
      if (num <= maxVal) {
        const updated = [...presets];
        updated[index] = { ...updated[index], value: num };
        onPresetsChange(presetsVisible, updated);
      }
    }
  }

  function togglePresetType(index: number) {
    const updated = [...presets];
    const current = updated[index];
    if (current.type === "percent") {
      updated[index] = { type: "dollar", value: 250 };
    } else {
      updated[index] = { type: "percent", value: 50 };
    }
    onPresetsChange(presetsVisible, updated);
  }
</script>

<div class="swap-settings">
  <span class="section-label">Slippage Tolerance</span>
  <div class="slippage-options">
    <button
      class="slippage-option"
      class:active={mode === "auto" && !isCustomActive}
      onclick={selectAuto}
    >
      Auto
    </button>
    {#each PRESETS as preset}
      <button
        class="slippage-option"
        class:active={mode === "fixed" && value === preset && !isCustomActive}
        onclick={() => selectPreset(preset)}
      >
        {preset}%
      </button>
    {/each}
    <div class="custom-input" class:active={isCustomActive}>
      <input
        type="text"
        inputmode="decimal"
        placeholder="Custom"
        value={customText}
        oninput={handleCustomInput}
      />
      <span class="suffix-static">%</span>
    </div>
  </div>

  <div class="divider"></div>

  <div class="percent-presets-header">
    <span class="section-label">Quick Amount Buttons</span>
    <button
      class="toggle-btn"
      class:active={presetsVisible}
      onclick={() => onPresetsChange(!presetsVisible, presets)}
      aria-label="Toggle quick amount buttons"
    >
      <span class="toggle-track">
        <span class="toggle-thumb"></span>
      </span>
    </button>
  </div>
  {#if presetsVisible}
    <div class="percent-presets-row">
      {#each presets as preset, i}
        <div class="preset-input-wrap">
          <input
            type="text"
            inputmode="numeric"
            value={preset.value}
            oninput={(e) => handlePresetValueInput(i, e)}
          />
          <button
            class="suffix-toggle"
            onclick={() => togglePresetType(i)}
            title="Click to switch to {preset.type === 'percent'
              ? 'dollar'
              : 'percent'} mode"
          >
            {preset.type === "percent" ? "%" : "$"}
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .swap-settings {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.875rem 1rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.875rem;
  }

  .section-label {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .divider {
    height: 1px;
    background: var(--border-color);
    margin: 0.25rem 0;
  }

  .slippage-options {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-wrap: wrap;
  }

  .slippage-option {
    padding: 0.4375rem 0.75rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .slippage-option:hover {
    background: var(--bg-card);
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .slippage-option.active {
    background: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }

  .custom-input {
    display: flex;
    align-items: center;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    padding-right: 0.625rem;
    transition: all 0.15s ease;
    width: 100%;
    min-width: 0;
    flex-shrink: 0;
  }

  .custom-input:focus-within {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .custom-input.active {
    border-color: var(--accent-primary);
  }

  .custom-input input {
    flex: 1;
    min-width: 0;
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    padding: 0.4375rem 0.375rem 0.4375rem 0.625rem;
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    font-family: "JetBrains Mono", monospace;
  }

  .custom-input input::placeholder {
    color: var(--text-muted);
    font-family: "Outfit", sans-serif;
  }

  .suffix-static {
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
    pointer-events: none;
    flex-shrink: 0;
  }

  /* --- Amount presets config --- */
  .percent-presets-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .toggle-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
  }

  .toggle-track {
    display: flex;
    align-items: center;
    width: 2rem;
    height: 1.125rem;
    border-radius: 999px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    padding: 2px;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
    position: relative;
  }

  .toggle-btn.active .toggle-track {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .toggle-thumb {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background: var(--text-muted);
    transition:
      transform 0.15s ease,
      background 0.15s ease;
    transform: translateX(0);
  }

  .toggle-btn.active .toggle-thumb {
    transform: translateX(calc(2rem - 0.75rem - 6px));
    background: white;
  }

  .percent-presets-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .preset-input-wrap {
    display: flex;
    align-items: center;
    flex: 1 1 calc(50% - 0.25rem);
    min-width: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    padding-right: 0;
    transition: border-color 0.15s ease;
  }

  .preset-input-wrap:focus-within {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .preset-input-wrap input {
    flex: 1;
    min-width: 0;
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    padding: 0.375rem 0.25rem 0.375rem 0.5rem;
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 500;
    font-family: "JetBrains Mono", monospace;
    text-align: center;
  }

  .suffix-toggle {
    background: none;
    border: none;
    border-left: 1px solid var(--border-color);
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.375rem 0.5rem;
    cursor: pointer;
    transition:
      color 0.15s ease,
      background 0.15s ease;
    flex-shrink: 0;
    border-radius: 0 0.5rem 0.5rem 0;
  }

  .suffix-toggle:hover {
    color: var(--accent-primary);
    background: rgba(59, 130, 246, 0.08);
  }
</style>
