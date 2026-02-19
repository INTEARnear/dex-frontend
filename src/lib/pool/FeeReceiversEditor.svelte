<script lang="ts">
  import { fly } from "svelte/transition";
  import { tokenHubStore } from "../tokenHubStore";
  import type { XykFeeReceiver } from "../types";
  import { User, CirclePlus, Wallet, Plus, X } from "lucide-svelte";

  export interface FeeReceiverDraft {
    receiver: XykFeeReceiver;
    percentage: string;
  }

  export interface FeeReceiversEditorState {
    receivers: FeeReceiverDraft[];
    totalFeePercentage: number;
    isFeeValid: boolean;
    hasDuplicateReceivers: boolean;
    areAllReceiversValid: boolean;
  }

  interface FeeReceiverFormItem extends FeeReceiverDraft {
    isValid: boolean | null;
    isChecking: boolean;
    warning: string | null;
  }

  interface Props {
    accountId: string | null;
    initialReceivers?: FeeReceiverDraft[];
    onChange?: (state: FeeReceiversEditorState) => void;
  }

  let {
    accountId,
    initialReceivers = [{ receiver: "Pool", percentage: "0.1" }],
    onChange,
  }: Props = $props();

  function isAccountReceiver(
    receiver: XykFeeReceiver,
  ): receiver is { Account: string } {
    return typeof receiver !== "string" && "Account" in receiver;
  }

  function toFormItem(draft: FeeReceiverDraft): FeeReceiverFormItem {
    return {
      receiver: draft.receiver,
      percentage: draft.percentage,
      isValid: draft.receiver === "Pool" ? true : null,
      isChecking: false,
      warning: null,
    };
  }

  function createEmptyAccountReceiver(): FeeReceiverFormItem {
    return {
      receiver: { Account: "" },
      percentage: "0",
      isValid: null,
      isChecking: false,
      warning: null,
    };
  }

  let feeReceivers = $state<FeeReceiverFormItem[]>([]);
  let hasInitialized = $state(false);

  $effect(() => {
    if (hasInitialized) return;
    feeReceivers = initialReceivers.map(toFormItem);
    hasInitialized = true;
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
    if (!accountId) return;
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

  async function validateAccount(index: number) {
    const item = feeReceivers[index];
    if (!item || !isAccountReceiver(item.receiver) || !item.receiver.Account.trim()) {
      if (item) {
        feeReceivers[index] = {
          ...item,
          isValid: null,
          isChecking: false,
          warning: null,
        };
        feeReceivers = [...feeReceivers];
      }
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
      const warning = nearBalance === 0 ? `${accountValue} has 0 NEAR` : null;
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
    if (!item) return;
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
    if (!feeReceivers[index]) return;
    if (percentage === "") {
      feeReceivers[index] = { ...feeReceivers[index], percentage: "" };
      feeReceivers = [...feeReceivers];
      return;
    }

    const num = parseFloat(percentage);
    if (!isNaN(num) && num >= 0) {
      const trimmed = Math.floor(num * 10000) / 10000;
      feeReceivers[index] = {
        ...feeReceivers[index],
        percentage: trimmed.toString(),
      };
      feeReceivers = [...feeReceivers];
    }
  }

  const hasDuplicateReceivers = $derived.by(() => {
    const seen = new Set<string>();
    for (const item of feeReceivers) {
      let key: string;
      if (item.receiver === "Pool") {
        key = "pool";
      } else {
        const acc = item.receiver.Account.trim().toLowerCase();
        if (!acc) continue;
        key = `account:${acc}`;
      }
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  });

  const totalFeePercentage = $derived.by(() =>
    feeReceivers.reduce((sum, r) => sum + (parseFloat(r.percentage) || 0), 0),
  );

  const isFeeValid = $derived(totalFeePercentage < 50);

  const areAllReceiversValid = $derived.by(() =>
    feeReceivers.every((item) => {
      if (item.receiver === "Pool") {
        return parseFloat(item.percentage) >= 0;
      }
      return (
        item.isValid === true &&
        item.receiver.Account.trim() !== "" &&
        parseFloat(item.percentage) >= 0
      );
    }),
  );

  $effect(() => {
    onChange?.({
      receivers: feeReceivers.map((item) => ({
        receiver: item.receiver,
        percentage: item.percentage,
      })),
      totalFeePercentage,
      isFeeValid,
      hasDuplicateReceivers,
      areAllReceiversValid,
    });
  });
</script>

<div class="section">
  <div class="section-header">
    <h3>Fee Receivers</h3>
    <span class="total-fee">Total: {totalFeePercentage.toFixed(4)}%</span>
  </div>

  <div class="fee-receivers">
    {#each feeReceivers as item, index (index)}
      <div class="fee-receiver" transition:fly={{ y: -10, duration: 150 }}>
        <div class="receiver-row">
          <div class="receiver-type">
            <button
              class="type-selector"
              class:is-pool={item.receiver === "Pool"}
              onclick={() =>
                setReceiverType(index, item.receiver === "Pool" ? "account" : "pool")}
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

          <div class="receiver-target">
            {#if isAccountReceiver(item.receiver)}
              <div class="account-input-wrapper">
                <input
                  type="text"
                  placeholder="you.near"
                  aria-label={`Fee receiver ${index + 1} account`}
                  aria-describedby={item.warning ? `receiver-warning-${index}` : undefined}
                  value={item.receiver.Account}
                  oninput={(e) => updateReceiverValue(index, e.currentTarget.value)}
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

          <div class="receiver-percentage">
            <input
              type="number"
              placeholder="0"
              aria-label={`Fee receiver ${index + 1} percentage`}
              value={item.percentage}
              oninput={(e) => updateReceiverPercentage(index, e.currentTarget.value)}
              min="0"
              max="100"
              step="0.0001"
            />
            <span class="percent-sign">%</span>
          </div>

          <button
            class="remove-btn"
            onclick={() => removeFeeReceiver(index)}
            aria-label="Remove receiver"
          >
            <X size={16} />
          </button>
        </div>

        {#if isAccountReceiver(item.receiver) && item.warning}
          <p id={`receiver-warning-${index}`} class="warning-text">{item.warning}</p>
        {/if}
      </div>
    {/each}
  </div>

  <button class="add-receiver-btn" onclick={addFeeReceiver}>
    <Plus size={14} />
    Add Receiver
  </button>
</div>

<style>
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
    color: var(--text-secondary);
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

  .account-input-wrapper input {
    flex: 1;
    min-width: 0;
    padding-left: 0.625rem;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 0.875rem;
    height: 100%;
  }

  .account-input-wrapper input:focus-visible {
    outline: none;
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
    background: var(--accent-button-small);
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
    transition: border-color 0.15s ease;
  }

  .receiver-percentage input:focus {
    border-color: var(--accent-primary);
  }

  .receiver-percentage input:focus-visible {
    outline: none;
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
    font-size: 0.825rem;
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

  @media (--tablet) {
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
  }

  @media (--mobile) {
    .receiver-percentage {
      width: 5rem;
    }

    .type-selector:not(.is-pool) span {
      display: none;
    }

    .account-input-wrapper input {
      padding-left: 0.5rem;
    }
  }
</style>
