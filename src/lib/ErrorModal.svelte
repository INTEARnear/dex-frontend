<script lang="ts">
  import { onDestroy } from "svelte";
  import { createChatwootModalVisibilityController } from "./chatwootBubbleVisibility";

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    message: string;
    /** If true, show "You cancelled..." for "User rejected the transaction" messages */
    isTransaction?: boolean;
  }

  let { isOpen, onClose, title = "Error", message, isTransaction = false }: Props =
    $props();

  const chatwootModalVisibility = createChatwootModalVisibilityController();

  onDestroy(() => {
    chatwootModalVisibility.dispose();
  });

  $effect(() => {
    chatwootModalVisibility.setVisible(isOpen);
  });

  function handleBackdropClick() {
    onClose();
  }

  function formatMessage(): string {
    if (
      isTransaction &&
      message.startsWith("User rejected the transaction")
    ) {
      return "You cancelled the transaction in your wallet";
    }
    return message;
  }
</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={handleBackdropClick}
    onkeydown={(e) => e.key === "Escape" && onClose()}
  >
    <div
      class="result-modal error-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="modal-icon error-icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <h3>{title}</h3>
      <p class="error-message">{formatMessage()}</p>
      <button class="modal-btn" onclick={onClose}>Close</button>
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

  .modal-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .error-icon {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }

  .result-modal h3 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .error-message {
    margin: 0;
    color: var(--text-secondary);
    text-align: center;
    font-size: 0.9375rem;
    line-height: 1.5;
    word-break: break-word;
    max-height: 150px;
    overflow-y: auto;
  }

  .modal-btn {
    width: 100%;
    padding: 0.875rem;
    margin-top: 0.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .modal-btn:hover {
    background: var(--bg-input);
    border-color: var(--accent-primary);
  }
</style>
