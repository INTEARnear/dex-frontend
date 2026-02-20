<script lang="ts">
  import { onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { LoaderCircle, CircleAlert, X } from "lucide-svelte";
  import { focusFirstElement, trapFocusKeydown } from "../a11y";
  import { walletStore } from "../walletStore";
  import { createChatwootModalVisibilityController } from "../chatwootBubbleVisibility";
  import type { XykFeeConfiguration, XykFeeReceiver } from "../types";
  import { DEX_CONTRACT_ID, DEX_ID, assertOutcomesSucceeded } from "./shared";
  import FeeReceiversEditor, {
    type FeeReceiverDraft,
    type FeeReceiversEditorState,
  } from "./FeeReceiversEditor.svelte";
  import { XykEditFeesArgsSchema, serializeToBase64 } from "../xykSchemas";

  interface Props {
    isOpen: boolean;
    poolId: number;
    configuration: XykFeeConfiguration;
    onClose: () => void;
    onSuccess: () => void;
  }

  let { isOpen, poolId, configuration, onClose, onSuccess }: Props = $props();

  const accountId = $derived($walletStore.accountId);
  const initialReceivers = $derived.by<FeeReceiverDraft[]>(() => {
    return configuration.receivers.map(([receiver, amount]) => {
      if (typeof amount === "number") {
        return {
          receiver: receiver,
          percentage: (amount / 10000).toString(),
        };
      }
      if ("Fixed" in amount) {
        return {
          receiver: receiver,
          percentage: (amount.Fixed / 10000).toString(),
        };
      }
      throw new Error("Unsupported fee amount type");
    });
  });

  let feeReceivers = $state<FeeReceiverDraft[]>([]);
  let totalFeePercentage = $state(0);
  let isFeeValid = $state(true);
  let hasDuplicateReceivers = $state(false);
  let areAllReceiversValid = $state(true);

  const isFormValid = $derived(
    isFeeValid && !hasDuplicateReceivers && areAllReceiversValid,
  );

  let isSubmitting = $state(false);
  let submitError = $state<string | null>(null);
  let modalRef = $state<HTMLDivElement | null>(null);
  let previouslyFocusedElement: HTMLElement | null = null;

  const chatwootModalVisibility = createChatwootModalVisibilityController();

  onDestroy(() => {
    chatwootModalVisibility.dispose();
  });

  $effect(() => {
    chatwootModalVisibility.setVisible(isOpen);
  });

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

  function handleEditorChange(state: FeeReceiversEditorState) {
    feeReceivers = state.receivers;
    totalFeePercentage = state.totalFeePercentage;
    isFeeValid = state.isFeeValid;
    hasDuplicateReceivers = state.hasDuplicateReceivers;
    areAllReceiversValid = state.areAllReceiversValid;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget && !isSubmitting) {
      onClose();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && !isSubmitting) {
      onClose();
    }
  }

  function handleModalKeyDown(e: KeyboardEvent) {
    if (!modalRef) return;
    if (e.key === "Escape" && !isSubmitting) {
      e.stopPropagation();
      onClose();
      return;
    }
    trapFocusKeydown(e, modalRef);
  }

  async function handleSubmit() {
    const wallet = $walletStore.wallet;
    if (!wallet) {
      submitError = "Please connect your wallet";
      return;
    }
    if (!accountId) {
      submitError = "Unable to resolve connected account";
      return;
    }
    if (!isFormValid) {
      submitError = "Please fix fee receiver validation errors";
      return;
    }

    isSubmitting = true;
    submitError = null;
    try {
      const args = serializeToBase64(XykEditFeesArgsSchema, {
        pool_id: poolId,
        fees: {
          receivers: feeReceivers
            .filter((item) => parseFloat(item.percentage) > 0)
            .map((item) => ({
              receiver:
                item.receiver === "Pool"
                  ? { Pool: {} }
                  : { User: item.receiver.Account },
              fee_fraction: Math.round(parseFloat(item.percentage) * 10000),
            })),
        },
      });

      const transactions = [
        {
          receiverId: DEX_CONTRACT_ID,
          actions: [
            {
              type: "FunctionCall" as const,
              params: {
                methodName: "execute_operations",
                args: {
                  operations: [
                    {
                      DexCall: {
                        dex_id: DEX_ID,
                        method: "edit_fees",
                        args,
                        attached_assets: {
                          near: "1" + "0".repeat(24 - 1), // 0.1 NEAR
                        } as Record<string, string>,
                      },
                    },
                  ],
                },
                gas: "120" + "0".repeat(12),
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
      submitError =
        error instanceof Error ? error.message : "Failed to update pool fees";
    } finally {
      isSubmitting = false;
    }
  }

  $effect(() => {
    if (!isOpen) {
      submitError = null;
      isSubmitting = false;
    }
  });
</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={handleBackdropClick}
    onkeydown={handleKeyDown}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="modal"
      bind:this={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-fees-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleModalKeyDown}
    >
      <div class="modal-header">
        <h2 id="edit-fees-title">Edit Fees</h2>
        <button class="close-btn" onclick={onClose} disabled={isSubmitting}>
          <X size={18} />
        </button>
      </div>

      <div class="modal-body">
        <FeeReceiversEditor
          {accountId}
          {initialReceivers}
          onChange={handleEditorChange}
        />
      </div>

      {#if !isFeeValid || hasDuplicateReceivers}
        <div class="form-errors" role="alert" aria-live="assertive">
          {#if !isFeeValid}
            <div class="form-error">
              <CircleAlert size={14} />
              <span>Total fee must be less than 50%</span>
            </div>
          {/if}
          {#if hasDuplicateReceivers}
            <div class="form-error">
              <CircleAlert size={14} />
              <span>Duplicate fee receivers are not allowed</span>
            </div>
          {/if}
        </div>
      {/if}

      {#if submitError}
        <div class="form-errors" role="alert" aria-live="assertive">
          <div class="form-error">
            <CircleAlert size={14} />
            <span>{submitError}</span>
          </div>
        </div>
      {/if}

      <div class="modal-footer">
        <button class="cancel-btn" onclick={onClose} disabled={isSubmitting}>
          Cancel
        </button>
        <button
          class="submit-btn"
          onclick={handleSubmit}
          disabled={!isFormValid || isSubmitting}
        >
          {#if isSubmitting}
            <LoaderCircle size={16} class="spinning" />
            Saving...
          {:else}
            Save Fees
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

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
    max-width: 520px;
    max-height: 90vh;
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
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-errors {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 0.625rem;
    margin: 0 1.5rem 1rem;
  }

  .form-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: #f87171;
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem;
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .cancel-btn,
  .submit-btn {
    flex: 1;
    padding: 0.875rem 1.5rem;
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
    color: white;
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

    .modal-header {
      padding: 1rem 1.25rem;
    }

    .modal-body {
      padding: 1.25rem;
    }

    .modal-footer {
      padding: 1rem 1.25rem;
      padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    }
  }

  @media (--mobile) {
    .modal-body {
      padding: 0.5rem;
    }
  }
</style>
