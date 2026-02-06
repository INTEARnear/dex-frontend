<script lang="ts">
  export type SlippageMode = "auto" | "fixed";

  interface Props {
    mode: SlippageMode;
    value: number; // human readable percentage, e.g. 0.5 for 0.5%
    onchange: (mode: SlippageMode, value: number) => void;
  }

  let { mode, value, onchange }: Props = $props();

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
</script>

<div class="slippage-selector">
  <span class="slippage-label">Slippage Tolerance</span>
  <div class="slippage-options">
    <button
      class="slippage-btn"
      class:active={mode === "auto" && !isCustomActive}
      onclick={selectAuto}
    >
      Auto
    </button>
    {#each PRESETS as preset}
      <button
        class="slippage-btn"
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
      <span class="custom-suffix">%</span>
    </div>
  </div>
</div>

<style>
  .slippage-selector {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.875rem 1rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.875rem;
  }

  .slippage-label {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .slippage-options {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-wrap: wrap;
  }

  .slippage-btn {
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

  .slippage-btn:hover {
    background: var(--bg-card);
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .slippage-btn.active {
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

  .custom-suffix {
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
    pointer-events: none;
    flex-shrink: 0;
  }
</style>
