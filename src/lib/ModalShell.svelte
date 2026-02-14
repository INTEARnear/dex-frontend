<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    dialogLabel?: string;
    modalClassName?: string;
    children?: Snippet;
  }

  let {
    isOpen,
    onClose,
    dialogLabel = "Modal",
    modalClassName = "",
    children,
  }: Props = $props();
</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={onClose}
    onkeydown={(e) => e.key === "Escape" && onClose()}
  >
    <div
      class={`result-modal ${modalClassName}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      {@render children?.()}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .result-modal {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1.25rem;
    padding: 2rem;
    max-width: 400px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    box-shadow:
      0 20px 25px -5px rgba(0, 0, 0, 0.4),
      0 10px 10px -5px rgba(0, 0, 0, 0.2);
    animation: modalSlideIn 0.2s ease-out;
  }

  @keyframes modalSlideIn {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(-10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
</style>
