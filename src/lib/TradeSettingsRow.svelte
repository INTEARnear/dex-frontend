<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    open?: boolean;
    settingsLabel: string;
    dialogLabel: string;
    closeBackdropLabel: string;
    bottomMargin?: string;
    presets?: Snippet;
    children?: Snippet;
  }

  let {
    open = $bindable(false),
    settingsLabel,
    dialogLabel,
    closeBackdropLabel,
    bottomMargin = "0.25rem",
    presets,
    children,
  }: Props = $props();
</script>

<div class="settings-row" style={`--settings-row-margin-bottom: ${bottomMargin};`}>
  {@render presets?.()}
  <div class="settings-anchor">
    <button class="settings-btn" onclick={() => (open = !open)}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <span class="settings-label">{settingsLabel}</span>
    </button>

    {#if open}
      <button
        class="swap-settings-backdrop"
        aria-label={closeBackdropLabel}
        onclick={() => (open = false)}
      ></button>
      <div
        class="swap-settings-popup"
        role="dialog"
        aria-label={dialogLabel}
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.key === "Escape" && (open = false)}
      >
        {@render children?.()}
      </div>
    {/if}
  </div>
</div>

<style>
  .settings-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    margin-bottom: var(--settings-row-margin-bottom);
  }

  .settings-anchor {
    position: relative;
    flex-shrink: 0;
  }

  .settings-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.625rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .settings-btn:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .settings-label {
    font-family: "JetBrains Mono", monospace;
  }

  .swap-settings-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
    background: rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(1px);
    border: none;
    padding: 0;
    margin: 0;
    cursor: default;
  }

  .swap-settings-popup {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    z-index: 100;
    width: 20.3412rem;
    max-width: calc(max(100vw - 7rem, 13rem));
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 0.875rem;
    box-shadow:
      0 10px 25px -5px rgba(0, 0, 0, 0.5),
      0 4px 10px -2px rgba(0, 0, 0, 0.3),
      0 0 0 1px rgba(59, 130, 246, 0.08);
    animation: popupFadeIn 0.15s ease-out;
  }

  @keyframes popupFadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
