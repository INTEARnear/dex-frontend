<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { CircleAlert, LoaderCircle, X } from "lucide-svelte";
  import { focusFirstElement, trapFocusKeydown } from "../a11y";
  import { walletStore } from "../walletStore";
  import { createChatwootModalVisibilityController } from "../chatwootBubbleVisibility";
  import ErrorModal from "../ErrorModal.svelte";
  import LaunchDataFields from "./LaunchDataFields.svelte";
  import { assertOutcomesSucceeded } from "../pool/shared";
  import type { LaunchDataArgs, LaunchApiTokenData } from "./types";

  const LAUNCH_CONTRACT_ID = "launch.intear.near";

  interface Props {
    isOpen: boolean;
    tokenAccountId: string;
    initialLaunchData: LaunchApiTokenData;
    onClose: () => void;
    onSuccess: () => void;
  }

  let { isOpen, tokenAccountId, initialLaunchData, onClose, onSuccess }: Props =
    $props();

  const chatwootModalVisibility = createChatwootModalVisibilityController();
  onDestroy(() => {
    chatwootModalVisibility.dispose();
  });
  $effect(() => {
    chatwootModalVisibility.setVisible(isOpen);
  });

  let modalRef = $state<HTMLDivElement | null>(null);
  let previouslyFocusedElement: HTMLElement | null = null;

  $effect(() => {
    if (!isOpen) return;

    previouslyFocusedElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    queueMicrotask(() => {
      if (modalRef) focusFirstElement(modalRef);
    });

    return () => {
      previouslyFocusedElement?.focus();
      previouslyFocusedElement = null;
    };
  });

  let description = $state("");
  let telegram = $state("");
  let x = $state("");
  let twitch = $state("");
  let website = $state("");

  let isSubmitting = $state(false);
  let submitError = $state<string | null>(null);
  let showErrorModal = $state(false);
  let txError = $state<string | null>(null);

  let prevIsOpen = $state(false);
  $effect(() => {
    const justOpened = isOpen && !prevIsOpen;
    prevIsOpen = isOpen;
    if (justOpened) {
      const data = untrack(() => initialLaunchData);
      if (data) {
        description = data.description ?? "";
        telegram = data.telegram ?? "";
        x = data.x ?? "";
        twitch = data.twitch ?? "";
        website = data.website ?? "";
      }
    }
  });

  const isDescriptionValid = $derived(description.length <= 200);
  const isTelegramValid = $derived.by(() => {
    if (telegram.length === 0) return true;
    if (telegram.length > 50) return false;
    return /^https:\/\/t\.me\/[^/]+$/.test(telegram);
  });
  const isXValid = $derived.by(() => {
    if (x.length === 0) return true;
    if (x.length > 50) return false;
    return /^https:\/\/x\.com\/[^/]+$/.test(x);
  });
  const isTwitchValid = $derived.by(() => {
    if (twitch.length === 0) return true;
    if (twitch.length > 50) return false;
    return /^https:\/\/twitch\.tv\/[^/]+$/.test(twitch);
  });
  const isWebsiteValid = $derived.by(() => {
    if (website.length === 0) return true;
    if (website.length > 50) return false;
    return website.startsWith("https://");
  });

  const validationErrors = $derived.by(() => {
    const errors: string[] = [];
    if (!isDescriptionValid) errors.push("Description must be 200 characters or fewer");
    if (!isTelegramValid) {
      errors.push("Telegram must start with https://t.me/ and be a valid link to a chat");
    }
    if (!isXValid) {
      errors.push("X must start with https://x.com/ and be a valid link to a profile");
    }
    if (!isTwitchValid) {
      errors.push(
        "Twitch must start with https://twitch.tv/ and be a valid link to a channel",
      );
    }
    if (!isWebsiteValid) errors.push("Website must start with https://");
    return errors;
  });

  const isFormValid = $derived(validationErrors.length === 0);

  function normalizeOptional(value: string): string | null {
    return value.length === 0 ? null : value;
  }

  async function handleSubmit(): Promise<void> {
    if (!isFormValid) {
      submitError = "Please fix validation errors";
      return;
    }

    const wallet = $walletStore.wallet;
    if (!wallet) {
      txError = "Please connect your wallet";
      showErrorModal = true;
      return;
    }

    isSubmitting = true;
    submitError = null;

    try {
      const launchData: LaunchDataArgs = {
        telegram: normalizeOptional(telegram),
        x: normalizeOptional(x),
        twitch: normalizeOptional(twitch),
        website: normalizeOptional(website),
        description: normalizeOptional(description),
      };

      const transactions = [
        {
          receiverId: LAUNCH_CONTRACT_ID,
          actions: [
            {
              type: "FunctionCall" as const,
              params: {
                methodName: "edit_token",
                args: {
                  token_account_id: tokenAccountId,
                  launch_data: launchData,
                },
                gas: "100" + "0".repeat(12), // 100 TGas
                deposit: "1" + "0".repeat(24 - 1), // 0.1 NEAR
              },
            },
          ],
        },
      ];

      const outcomes = await wallet.signAndSendTransactions({ transactions });
      assertOutcomesSucceeded(outcomes);
      onSuccess();
      onClose();
    } catch (error) {
      txError = error instanceof Error ? error.message : "Failed to edit token";
      showErrorModal = true;
    } finally {
      isSubmitting = false;
    }
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget && !isSubmitting) {
      onClose();
    }
  }

  function handleModalKeyDown(event: KeyboardEvent): void {
    if (!modalRef) return;
    if (event.key === "Escape" && !isSubmitting) {
      event.stopPropagation();
      onClose();
      return;
    }
    trapFocusKeydown(event, modalRef);
  }

  function handleBackdropKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !isSubmitting) {
      onClose();
    }
  }
</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={handleBackdropClick}
    onkeydown={handleBackdropKeyDown}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="modal"
      bind:this={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-token-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={handleModalKeyDown}
      transition:fly={{ y: 20, duration: 200 }}
    >
      <div class="modal-header">
        <h2 id="edit-token-title">Edit Token</h2>
        <button class="close-btn" onclick={onClose} aria-label="Close" disabled={isSubmitting}>
          <X size={20} />
        </button>
      </div>

      <div class="modal-body">
        <LaunchDataFields bind:description bind:telegram bind:x bind:twitch bind:website />
      </div>

      {#if validationErrors.length > 0 || submitError}
        <div class="form-errors" role="alert" aria-live="assertive">
          {#if submitError}
            <div class="form-error">
              <CircleAlert size={14} />
              <span>{submitError}</span>
            </div>
          {/if}
          {#each validationErrors as errorMessage (errorMessage)}
            <div class="form-error">
              <CircleAlert size={14} />
              <span>{errorMessage}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="modal-footer">
        <button class="cancel-btn" onclick={onClose} disabled={isSubmitting}>Cancel</button>
        <button
          class="submit-btn"
          onclick={handleSubmit}
          disabled={!isFormValid || isSubmitting}
        >
          {#if isSubmitting}
            <LoaderCircle size={16} class="spinning" />
            Saving...
          {:else}
            Save
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<ErrorModal
  isOpen={showErrorModal}
  onClose={() => {
    showErrorModal = false;
    txError = null;
  }}
  title="Edit Token Failed"
  message={txError ?? ""}
  isTransaction={true}
/>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal {
    width: 100%;
    max-width: 560px;
    max-height: 92vh;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1.25rem;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .close-btn {
    width: 2.25rem;
    height: 2.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .close-btn:hover:not(:disabled) {
    background: var(--bg-input);
    color: var(--text-primary);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-errors {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.75rem 1rem;
    background: var(--status-error-soft-bg);
    border: 1px solid var(--status-error-soft-border);
    border-radius: 0.625rem;
    margin: 0.6rem 1.5rem 0.75rem;
  }

  .form-error {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    color: var(--status-error-text);
    font-size: 0.8rem;
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    padding: 1.15rem 1.5rem;
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .cancel-btn,
  .submit-btn {
    flex: 1;
    padding: 0.8rem 1.25rem;
    border-radius: 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .cancel-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .cancel-btn:hover:not(:disabled) {
    background: var(--bg-input);
    border-color: var(--text-muted);
  }

  .submit-btn {
    background: var(--accent-button-small);
    border: none;
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .submit-btn:disabled,
  .cancel-btn:disabled,
  .close-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .submit-btn :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (--tablet) {
    .modal-backdrop {
      padding: 0;
      align-items: flex-end;
    }

    .modal {
      max-width: 100%;
      max-height: 95vh;
      border-radius: 1.25rem 1.25rem 0 0;
      border-bottom: none;
    }

    .modal-header,
    .modal-footer {
      padding-left: 1.25rem;
      padding-right: 1.25rem;
    }

    .modal-body {
      padding: 1rem 1.25rem;
    }

    .modal-footer {
      padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
