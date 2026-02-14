<script lang="ts">
  export interface DexPresetButtonItem {
    id: string | number;
    label: string;
    active?: boolean;
    disabled?: boolean;
    insufficientDollar?: boolean;
    onClick?: () => void;
  }

  interface Props {
    items: DexPresetButtonItem[];
  }

  let { items }: Props = $props();
</script>

<div class="dex-preset-buttons">
  {#each items as item (item.id)}
    <button
      class="dex-preset-btn"
      class:active={!!item.active}
      class:insufficient-dollar={!!item.insufficientDollar}
      onclick={() => item.onClick?.()}
      disabled={!!item.disabled}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .dex-preset-buttons {
    display: flex;
    gap: 1rem;
    margin-right: auto;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    flex-shrink: 1;
    min-width: 0;
  }

  .dex-preset-buttons::-webkit-scrollbar {
    display: none;
  }

  .dex-preset-btn {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
    font-family: "JetBrains Mono", monospace;
    cursor: pointer;
    transition: color 0.15s ease;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .dex-preset-btn:hover,
  .dex-preset-btn.active {
    color: var(--accent-primary);
  }

  .dex-preset-btn.insufficient-dollar,
  .dex-preset-btn.insufficient-dollar:hover {
    color: #f87171;
    cursor: not-allowed;
  }

  .dex-preset-btn:disabled {
    opacity: 1;
  }

  @media (--mobile) {
    .dex-preset-btn {
      font-size: 0.75rem;
    }
  }
</style>
