<script lang="ts">
  import { onDestroy } from "svelte";
  import { createChatwootModalVisibilityController } from "./chatwootBubbleVisibility";
  import ModalShell from "./ModalShell.svelte";

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

<ModalShell isOpen={isOpen} {onClose} modalClassName="error-modal" dialogLabel={title}>
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
  <h3 class="modal-title">{title}</h3>
  <p class="error-message">{formatMessage()}</p>
  <button class="modal-btn" onclick={onClose}>Close</button>
</ModalShell>

<style>
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

  .modal-title {
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
