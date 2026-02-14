<script lang="ts">
  import { onDestroy } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { walletStore } from "./walletStore";
  import { tokenHubStore } from "./tokenHubStore";
  import TokenSelector from "./TokenSelector.svelte";
  import TokenIcon from "./TokenIcon.svelte";
  import type { Token, XykFeeReceiver } from "./types";
  import {
    User,
    CirclePlus,
    Check,
    AlertCircle,
    X,
    Wallet,
    Plus,
    Loader2,
  } from "lucide-svelte";
  import {
    XykCreatePoolArgsSchema,
    assetId,
    serializeToBase64,
    type XykCreatePoolArgs,
  } from "./xykSchemas";
  import { createChatwootModalVisibilityController } from "./chatwootBubbleVisibility";

  const DEX_CONTRACT_ID = "dex.intear.near";
  const DEX_ID = "slimedragon.near/xyk";
  const DEX_BACKEND_API = "https://dex-backend.intear.tech";

  function tokenToAssetId(token: Token): Record<string, unknown> {
    if (token.account_id === "near") {
      return assetId("Near");
    }
    return assetId("Nep141", token.account_id);
  }

  function serializeCreatePoolArgs(
    token1: Token,
    token2: Token,
    feeReceivers: Array<{ receiver: XykFeeReceiver; percentage: string }>,
    isPublic: boolean,
  ): string {
    const receivers = feeReceivers
      .filter((r) => parseFloat(r.percentage) > 0)
      .map((r) => {
        const feeFraction = Math.round(parseFloat(r.percentage) * 10000);
        const receiver =
          r.receiver === "Pool" ? { Pool: {} } : { User: r.receiver.Account };
        return { receiver, fee_fraction: feeFraction };
      });

    const args: XykCreatePoolArgs = {
      assets: [tokenToAssetId(token1), tokenToAssetId(token2)],
      fees: { receivers },
      is_public: isPublic,
    };

    return serializeToBase64(XykCreatePoolArgsSchema, args);
  }

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (poolId: number) => void;
  }

  function extractCreatedPoolIdFromOutcomes(outcomes: unknown): number | null {
    if (!outcomes || !Array.isArray(outcomes)) return null;

    for (const outcome of outcomes) {
      if (!outcome?.receipts_outcome) continue;

      for (const receiptOutcome of outcome.receipts_outcome) {
        if (receiptOutcome.outcome.executor_id !== DEX_CONTRACT_ID) {
          throw new Error("Executor ID mismatch. This should never happen.");
        }
        const logs = receiptOutcome.outcome?.logs;
        if (!logs || !Array.isArray(logs)) continue;

        for (const log of logs) {
          if (typeof log !== "string") continue;

          const eventPrefix = "EVENT_JSON:";
          if (!log.startsWith(eventPrefix)) continue;

          try {
            const eventData = JSON.parse(log.slice(eventPrefix.length));

            if (
              eventData.standard === "inteardex" &&
              eventData.event === "dex_event" &&
              eventData.data?.event?.event === "pool_updated"
            ) {
              const poolId = eventData.data.event.data.pool_id;
              if (typeof poolId === "number") {
                return poolId;
              }
            }
          } catch {
            throw new Error("Unexpected invalid nep-297 from dex.intear.near");
          }
        }
      }
    }

    return null;
  }

  interface FeeReceiverFormItem {
    receiver: XykFeeReceiver;
    percentage: string;
    // Account type can be checked
    isValid: boolean | null;
    isChecking: boolean;
    warning: string | null;
  }

  let { isOpen, onClose, onSuccess }: Props = $props();
  const chatwootModalVisibility = createChatwootModalVisibilityController();

  onDestroy(() => {
    chatwootModalVisibility.dispose();
  });

  $effect(() => {
    chatwootModalVisibility.setVisible(isOpen);
  });

  let token1 = $state<Token | null>(null);
  let token2 = $state<Token | null>(null);
  let isPrivate = $state(false);

  function createEmptyAccountReceiver(): FeeReceiverFormItem {
    return {
      receiver: { Account: "" },
      percentage: "0",
      isValid: null,
      isChecking: false,
      warning: null,
    };
  }

  let feeReceivers = $state<FeeReceiverFormItem[]>([
    {
      receiver: "Pool",
      percentage: "0.1",
      isValid: true,
      isChecking: false,
      warning: null,
    },
  ]);

  let showToken1Selector = $state(false);
  let showToken2Selector = $state(false);

  function isAccountReceiver(
    receiver: XykFeeReceiver,
  ): receiver is { Account: string } {
    return typeof receiver !== "string" && "Account" in receiver;
  }

  const accountId = $derived($walletStore.accountId);

  // Pre-fetch tokens when modal opens
  $effect(() => {
    if (
      isOpen &&
      $tokenHubStore.tokens.length === 0 &&
      !$tokenHubStore.status.tokens
    ) {
      tokenHubStore.refreshTokens();
    }
  });

  function addFeeReceiver() {
    feeReceivers = [...feeReceivers, createEmptyAccountReceiver()];
  }

  function removeFeeReceiver(index: number) {
    feeReceivers = feeReceivers.filter((_, i) => i !== index);
  }

  function setReceiverType(index: number, type: "account" | "pool") {
    if (type === "pool") {
      feeReceivers[index] = {
        receiver: "Pool",
        percentage: feeReceivers[index].percentage,
        isValid: true,
        isChecking: false,
        warning: null,
      };
    } else {
      feeReceivers[index] = {
        receiver: { Account: "" },
        percentage: feeReceivers[index].percentage,
        isValid: null,
        isChecking: false,
        warning: null,
      };
    }
    feeReceivers = [...feeReceivers];
  }

  function setMyWallet(index: number) {
    if (accountId) {
      feeReceivers[index] = {
        receiver: { Account: accountId },
        percentage: feeReceivers[index].percentage,
        isValid: true,
        isChecking: false,
        warning: null,
      };
      feeReceivers = [...feeReceivers];
      validateAccount(index);
    }
  }

  async function validateAccount(index: number) {
    const item = feeReceivers[index];
    if (!isAccountReceiver(item.receiver) || !item.receiver.Account.trim()) {
      feeReceivers[index] = {
        ...item,
        isValid: null,
        isChecking: false,
        warning: null,
      };
      feeReceivers = [...feeReceivers];
      return;
    }

    const accountValue = item.receiver.Account.trim();
    feeReceivers[index] = { ...item, isChecking: true, warning: null };
    feeReceivers = [...feeReceivers];

    try {
      const data = await tokenHubStore.fetchAccountTokens(accountValue);

      const nearToken = data.find(
        (t: { token: { account_id: string }; balance: string }) =>
          t.token.account_id === "near",
      );
      const nearBalance = nearToken ? parseFloat(nearToken.balance) : 0;

      let warning: string | null = null;
      if (nearBalance === 0) {
        warning = `${accountValue} has 0 NEAR`;
      }

      feeReceivers[index] = {
        ...feeReceivers[index],
        isValid: true,
        isChecking: false,
        warning,
      };
      feeReceivers = [...feeReceivers];
    } catch {
      feeReceivers[index] = {
        ...feeReceivers[index],
        isValid: false,
        isChecking: false,
        warning: null,
      };
      feeReceivers = [...feeReceivers];
    }
  }

  function updateReceiverValue(index: number, value: string) {
    const item = feeReceivers[index];
    feeReceivers[index] = {
      ...item,
      receiver: { Account: value },
      isValid: null,
      warning: null,
    };
    feeReceivers = [...feeReceivers];

    if (value.trim()) {
      validateAccount(index);
    }
  }

  function updateReceiverPercentage(index: number, percentage: string) {
    // Trim to 4 decimal places, supported by the contractg
    if (percentage === "") {
      feeReceivers[index] = { ...feeReceivers[index], percentage: "" };
      feeReceivers = [...feeReceivers];
      return;
    }

    const num = parseFloat(percentage);
    if (!isNaN(num) && num >= 0 && num <= 100) {
      const trimmed = Math.floor(num * 10000) / 10000;
      feeReceivers[index] = {
        ...feeReceivers[index],
        percentage: trimmed.toString(),
      };
      feeReceivers = [...feeReceivers];
    }
  }

  const hasDuplicateReceivers = $derived(() => {
    const seen = new Set<string>();
    for (const item of feeReceivers) {
      let key: string;
      if (item.receiver === "Pool") {
        key = "pool";
      } else {
        const acc = item.receiver.Account.trim().toLowerCase();
        if (!acc) continue; // Skip empty accounts
        key = `account:${acc}`;
      }
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  });

  const totalFeePercentage = $derived(
    feeReceivers.reduce((sum, r) => sum + (parseFloat(r.percentage) || 0), 0),
  );

  const isFeeValid = $derived(totalFeePercentage < 50);

  const isFormValid = $derived(
    token1 !== null &&
      token2 !== null &&
      token1.account_id !== token2.account_id &&
      feeReceivers.every((item) => {
        if (item.receiver === "Pool") {
          return parseFloat(item.percentage) >= 0;
        }
        return (
          item.isValid === true &&
          item.receiver.Account.trim() !== "" &&
          parseFloat(item.percentage) >= 0
        );
      }) &&
      isFeeValid &&
      !hasDuplicateReceivers(),
  );

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    }
  }

  function handleSelectToken1(token: Token) {
    token1 = token;
    showToken1Selector = false;
  }

  function handleSelectToken2(token: Token) {
    token2 = token;
    showToken2Selector = false;
  }

  let isCreating = $state(false);
  let createError = $state<string | null>(null);

  async function handleCreate() {
    if (!token1 || !token2) {
      createError = "Please select both tokens";
      return;
    }

    const wallet = $walletStore.wallet;
    if (!wallet) {
      createError = "Please connect your wallet";
      return;
    }
    if (!accountId) {
      createError = "Unable to resolve connected account";
      return;
    }

    isCreating = true;
    createError = null;

    try {
      const argsBase64 = serializeCreatePoolArgs(
        token1,
        token2,
        feeReceivers,
        !isPrivate, // is_public
      );

      const registrationActions = [
        {
          type: "FunctionCall" as const,
          params: {
            methodName: "storage_deposit",
            args: {
              registration_only: true,
            },
            gas: "10" + "0".repeat(12), // 10 TGas
            deposit: "1" + "0".repeat(24 - 2), // 0.01 NEAR
          },
        },
        {
          type: "FunctionCall" as const,
          params: {
            methodName: "register_assets",
            args: {
              asset_ids: ["near"],
            },
            gas: "10" + "0".repeat(12), // 10 TGas
            deposit: "1",
          },
        },
      ];
      const registrationCheckResponse = await fetch(
        `${DEX_BACKEND_API}/are-assets-registered?for=${encodeURIComponent(JSON.stringify({ Account: accountId }))}&assets=near`,
      );
      if (!registrationCheckResponse.ok) {
        throw new Error("Failed to check NEAR asset registration");
      }
      const isNearRegistered: boolean = await registrationCheckResponse.json();

      const actions = [
        ...(isNearRegistered ? [] : registrationActions),
        {
          type: "FunctionCall" as const,
          params: {
            methodName: "execute_operations",
            args: {
              operations: [
                {
                  DexCall: {
                    dex_id: DEX_ID,
                    method: "create_pool",
                    args: argsBase64,
                    attached_assets: {
                      near: "1" + "0".repeat(24 - 2), // 0.01 NEAR
                    },
                  },
                },
              ],
            },
            gas: "100" + "0".repeat(12), // 100 TGas
            deposit: "1" + "0".repeat(24 - 2), // 0.01 NEAR
          },
        },
      ];
      const transactions = [
        {
          receiverId: DEX_CONTRACT_ID,
          actions,
        },
      ];

      const outcomes = await wallet.signAndSendTransactions({ transactions });
      console.log("Pool creation result:", outcomes);

      if (outcomes && Array.isArray(outcomes)) {
        for (const outcome of outcomes) {
          if (outcome && outcome.receipts_outcome) {
            for (const receiptOutcome of outcome.receipts_outcome) {
              const status = receiptOutcome.outcome?.status;
              if (status?.Failure) {
                const executionError =
                  status.Failure?.ActionError?.kind?.FunctionCallError
                    ?.ExecutionError;
                throw new Error(
                  executionError || JSON.stringify(status.Failure),
                );
              }
            }
          }
        }
      }

      const poolId = extractCreatedPoolIdFromOutcomes(outcomes);
      console.log("Created pool ID:", poolId);

      if (poolId !== null) {
        onSuccess(poolId);
      }
      onClose();
    } catch (error) {
      console.error("Pool creation failed:", error);
      createError =
        error instanceof Error ? error.message : "Failed to create pool";
    } finally {
      isCreating = false;
    }
  }

  // Reset form when modal closes
  $effect(() => {
    if (!isOpen) {
      token1 = null;
      token2 = null;
      isPrivate = false;
      feeReceivers = [
        {
          receiver: "Pool",
          percentage: "0.1",
          isValid: true,
          isChecking: false,
          warning: null,
        },
      ];
      createError = null;
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
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      transition:fly={{ y: 20, duration: 200 }}
    >
      <div class="modal-header">
        <h2 id="modal-title">Create Pool</h2>
        <button class="close-btn" onclick={onClose} aria-label="Close">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <!-- Token Selection -->
        <div class="section">
          <h3>Token Pair</h3>
          <div class="token-pair-row">
            <button
              class="token-select-btn"
              onclick={() => (showToken1Selector = true)}
            >
              {#if token1}
                <div class="selected-token">
                  <TokenIcon token={token1} size={28} showBadge badgeSmall />
                  <span>{token1.metadata.symbol}</span>
                </div>
              {:else}
                <span class="placeholder">Select token</span>
              {/if}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div class="pair-separator">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>

            <button
              class="token-select-btn"
              onclick={() => (showToken2Selector = true)}
            >
              {#if token2}
                <div class="selected-token">
                  <TokenIcon token={token2} size={28} showBadge badgeSmall />
                  <span>{token2.metadata.symbol}</span>
                </div>
              {:else}
                <span class="placeholder">Select token</span>
              {/if}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Fee Receivers -->
        <div class="section">
          <div class="section-header">
            <h3>Fee Receivers</h3>
            <span class="total-fee">
              Total: {totalFeePercentage.toFixed(4)}%
            </span>
          </div>

          <div class="fee-receivers">
            {#each feeReceivers as item, index (index)}
              <div
                class="fee-receiver"
                transition:fly={{ y: -10, duration: 150 }}
              >
                <div class="receiver-row">
                  <!-- Type selector as dropdown-style button -->
                  <div class="receiver-type">
                    <button
                      class="type-selector"
                      class:is-pool={item.receiver === "Pool"}
                      onclick={() =>
                        setReceiverType(
                          index,
                          item.receiver === "Pool" ? "account" : "pool",
                        )}
                    >
                      {#if item.receiver === "Pool"}
                        <CirclePlus size={16} />
                        <span>Pool</span>
                      {:else}
                        <User size={16} />
                        <span>Account</span>
                      {/if}
                    </button>
                  </div>

                  <!-- Middle section: input -->
                  <div class="receiver-target">
                    {#if isAccountReceiver(item.receiver)}
                      <div class="account-input-wrapper">
                        <input
                          type="text"
                          placeholder="you.near"
                          value={item.receiver.Account}
                          oninput={(e) =>
                            updateReceiverValue(index, e.currentTarget.value)}
                          class:valid={item.isValid === true && !item.warning}
                          class:invalid={item.isValid === false}
                          class:warning={item.isValid === true && item.warning}
                        />
                        <div class="input-actions">
                          {#if accountId}
                            <button
                              class="wallet-btn"
                              onclick={() => setMyWallet(index)}
                              title="Use my wallet"
                            >
                              <Wallet size={14} />
                            </button>
                          {/if}
                        </div>
                      </div>
                    {/if}
                  </div>

                  <!-- Percentage input -->
                  <div class="receiver-percentage">
                    <input
                      type="number"
                      placeholder="0"
                      value={item.percentage}
                      oninput={(e) =>
                        updateReceiverPercentage(index, e.currentTarget.value)}
                      min="0"
                      max="100"
                      step="0.0001"
                    />
                    <span class="percent-sign">%</span>
                  </div>

                  <!-- Remove button -->
                  <button
                    class="remove-btn"
                    onclick={() => removeFeeReceiver(index)}
                    aria-label="Remove receiver"
                  >
                    <X size={16} />
                  </button>
                </div>

                {#if isAccountReceiver(item.receiver) && item.warning}
                  <p class="warning-text">{item.warning}</p>
                {/if}
              </div>
            {/each}
          </div>

          <button class="add-receiver-btn" onclick={addFeeReceiver}>
            <Plus size={14} />
            Add Receiver
          </button>
        </div>

        <!-- Private Pool Toggle -->
        <div class="section">
          <div class="toggle-row">
            <div class="toggle-info">
              <h3>Private Pool</h3>
              <p class="toggle-description">
                In a private pool, you can edit fees at any time, but only you
                can deposit liquidity.
              </p>
            </div>
            <button
              class="toggle-switch"
              class:active={isPrivate}
              onclick={() => (isPrivate = !isPrivate)}
              role="switch"
              aria-checked={isPrivate}
              aria-label="Toggle private pool"
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>
        </div>
      </div>

      {#if !isFeeValid || hasDuplicateReceivers() || (token1 && token2 && token1.account_id === token2.account_id)}
        <div class="form-errors">
          {#if !isFeeValid}
            <div class="form-error">
              <AlertCircle size={14} />
              <span>Total fee must be less than 50%</span>
            </div>
          {/if}
          {#if hasDuplicateReceivers()}
            <div class="form-error">
              <AlertCircle size={14} />
              <span>Duplicate fee receivers are not allowed</span>
            </div>
          {/if}
          {#if token1 && token2 && token1.account_id === token2.account_id}
            <div class="form-error">
              <AlertCircle size={14} />
              <span>Please select two different tokens</span>
            </div>
          {/if}
        </div>
      {/if}

      {#if createError}
        <div class="form-errors">
          <div class="form-error">
            <AlertCircle size={14} />
            <span>{createError}</span>
          </div>
        </div>
      {/if}

      <div class="modal-footer">
        <button class="cancel-btn" onclick={onClose} disabled={isCreating}
          >Cancel</button
        >
        <button
          class="create-btn"
          onclick={handleCreate}
          disabled={!isFormValid || isCreating}
        >
          {#if isCreating}
            <Loader2 size={16} class="spinning" />
            Creating...
          {:else}
            Create Pool
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<TokenSelector
  isOpen={showToken1Selector}
  onClose={() => (showToken1Selector = false)}
  onSelectToken={handleSelectToken1}
/>

<TokenSelector
  isOpen={showToken2Selector}
  onClose={() => (showToken2Selector = false)}
  onSelectToken={handleSelectToken2}
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

  .close-btn:hover {
    background: var(--bg-input);
    color: var(--text-primary);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section h3 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .total-fee {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    font-family: "JetBrains Mono", monospace;
  }

  /* Form Errors Section */
  .form-errors {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 0.625rem;
    margin: 0 1.5rem;
    margin-bottom: 1.5rem;
  }

  .form-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #ef4444;
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .form-error :global(svg) {
    flex-shrink: 0;
  }

  /* Token Pair Selection */
  .token-pair-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .token-select-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .token-select-btn:hover {
    border-color: var(--accent-primary);
    background: var(--bg-secondary);
  }

  .selected-token {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .placeholder {
    color: var(--text-muted);
  }

  .pair-separator {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  /* Fee Receivers */
  .fee-receivers {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .fee-receiver {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .receiver-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.625rem;
  }

  .type-selector {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    height: 2.25rem;
  }

  .type-selector :global(svg:first-child) {
    width: 16px;
    height: 16px;
  }

  .type-selector:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .type-selector.is-pool {
    background: rgba(59, 130, 246, 0.1);
    border-color: rgba(59, 130, 246, 0.3);
    color: var(--accent-primary);
    flex: 1;
  }

  .receiver-type {
    flex-shrink: 0;
    display: flex;
  }

  .receiver-row:has(.type-selector.is-pool) .receiver-type {
    flex: 1;
  }

  .receiver-row:has(.type-selector.is-pool) .receiver-target {
    display: none;
  }

  .receiver-target {
    flex: 1;
    min-width: 0;
  }

  .account-input-wrapper {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    padding-right: 0.25rem;
    height: 2.25rem;
    transition: border-color 0.15s ease;
  }

  .account-input-wrapper:focus-within {
    border-color: var(--accent-primary);
  }

  .account-input-wrapper:has(input.valid) {
    border-color: #22c55e;
  }

  .account-input-wrapper:has(input.invalid) {
    border-color: #ef4444;
  }

  .account-input-wrapper:has(input.warning) {
    border-color: #eab308;
  }

  .account-input-wrapper input {
    flex: 1;
    min-width: 0;
    padding-left: 0.625rem;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 0.875rem;
    outline: none;
    height: 100%;
  }

  .account-input-wrapper input::placeholder {
    color: var(--text-muted);
  }

  .input-actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    flex-shrink: 0;
  }

  .wallet-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .wallet-btn:hover {
    background: var(--accent-primary);
    color: white;
  }

  .receiver-percentage {
    position: relative;
    flex-shrink: 0;
    width: 7rem;
  }

  .receiver-percentage input {
    width: 100%;
    height: 2.25rem;
    padding: 0 1.5rem 0 0.625rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: "JetBrains Mono", monospace;
    text-align: right;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .receiver-percentage input:focus {
    border-color: var(--accent-primary);
  }

  .percent-sign {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    font-size: 0.875rem;
    pointer-events: none;
  }

  .remove-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
    margin: -0.5rem;
    margin-right: -0.375rem;
  }

  .remove-btn:hover {
    color: #ef4444;
  }

  .warning-text {
    margin: 0 0.5rem;
    font-size: 0.6875rem;
    color: #eab308;
  }

  .add-receiver-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    padding: 0.5rem;
    background: transparent;
    border: 1px dashed var(--border-color);
    border-radius: 0.5rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .add-receiver-btn:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    background: rgba(59, 130, 246, 0.03);
  }

  /* Private Pool Toggle */
  .toggle-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
  }

  .toggle-info {
    flex: 1;
    min-width: 0;
  }

  .toggle-info h3 {
    margin-bottom: 0.25rem;
  }

  .toggle-description {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .toggle-switch {
    width: 3rem;
    height: 1.75rem;
    padding: 0.125rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 1rem;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .toggle-switch.active {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .toggle-thumb {
    display: block;
    width: 1.25rem;
    height: 1.25rem;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .toggle-switch.active .toggle-thumb {
    transform: translateX(1.25rem);
  }

  /* Modal Footer */
  .modal-footer {
    display: flex;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem;
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .cancel-btn {
    flex: 1;
    padding: 0.875rem 1.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .cancel-btn:hover {
    background: var(--bg-input);
    border-color: var(--text-muted);
  }

  .create-btn {
    flex: 1;
    padding: 0.875rem 1.5rem;
    background: var(--accent-primary);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .create-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .create-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .create-btn :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  .create-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  /* Mobile Responsive */
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

    .modal-header h2 {
      font-size: 1.125rem;
    }

    .modal-body {
      padding: 1.25rem;
      gap: 1.25rem;
    }

    .token-pair-row {
      flex-direction: column;
    }

    .token-select-btn {
      width: 100%;
    }

    .pair-separator {
      transform: rotate(90deg);
    }

    .receiver-row {
      flex-wrap: wrap;
      gap: 0.375rem;
    }

    .receiver-percentage {
      width: 6rem;
    }

    .remove-btn {
      margin: -0.25rem;
    }

    .receiver-target {
      width: 100%;
    }

    .modal-footer {
      padding: 1rem 1.25rem;
      padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    }
  }

  @media (--mobile) {
    .receiver-percentage {
      width: 5rem;
    }

    .type-selector:not(.is-pool) span {
      display: none;
    }

    .modal-body {
      padding: 0.5rem;
      gap: 1.25rem;
    }

    .account-input-wrapper input {
      padding-left: 0.5rem;
    }
  }
</style>
