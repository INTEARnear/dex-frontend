<script lang="ts">
  import { fly } from "svelte/transition";
  import { tokenHubStore } from "../tokenHubStore";
  import type { XykFeeReceiver } from "../types";
  import { User, CirclePlus, Wallet, Plus, X, ArrowRight } from "lucide-svelte";
  import ScheduledFeeChart, {
    type ScheduledFeeChartPoint,
  } from "./ScheduledFeeChart.svelte";
  import {
    durationToNanoseconds,
    nowDateTimeLocal,
    timestampNanosToDateTimeLocal,
    tryDateTimeLocalToTimestampNanos,
  } from "./feeUtils";

  export type FeeAmountDraft =
    | {
        kind: "fixed";
        percentage: string;
      }
    | {
        kind: "scheduled";
        startDateTime: string;
        durationHours: string;
        durationMinutes: string;
        startPercentage: string;
        endPercentage: string;
        startPreset: "custom" | "now";
      };

  export interface FeeReceiverDraft {
    receiver: XykFeeReceiver;
    amount: FeeAmountDraft;
  }

  export interface FeeReceiversEditorState {
    receivers: FeeReceiverDraft[];
    totalFeePercentage: number;
    isFeeValid: boolean;
    hasDuplicateReceivers: boolean;
    areAllReceiversValid: boolean;
    hasScheduledDurationError: boolean;
    hasScheduledFeeDirectionError: boolean;
  }

  interface FeeReceiverFormItem extends FeeReceiverDraft {
    id: string;
    isValid: boolean | null;
    isChecking: boolean;
    warning: string | null;
    validationRequestId: number;
  }

  interface Props {
    accountId: string | null;
    initialReceivers?: FeeReceiverDraft[];
    onChange: (state: FeeReceiversEditorState) => void;
  }

  function getScheduledDurationNs(amount: FeeAmountDraft): number | null {
    if (amount.kind !== "scheduled") return null;
    return durationToNanoseconds(amount.durationHours, amount.durationMinutes);
  }

  function getEffectiveStartTimestampNs(
    amount: FeeAmountDraft,
    nowTimestampNs: number,
  ): number | null {
    if (amount.kind !== "scheduled") return null;
    if (amount.startPreset === "now") return nowTimestampNs;
    return tryDateTimeLocalToTimestampNanos(amount.startDateTime);
  }

  function parsePercentage(value: string): number | null {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizePercentageInput(value: string): string {
    if (value === "") return "";
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) return value;
    const truncated = Math.floor(parsed * 10000) / 10000;
    return truncated.toString();
  }

  function createDefaultScheduledFee(percentage = "0"): FeeAmountDraft {
    return {
      kind: "scheduled",
      startDateTime: nowDateTimeLocal(),
      durationHours: "1",
      durationMinutes: "0",
      startPercentage: (parseFloat(percentage) * 2).toString(),
      endPercentage: (parseFloat(percentage) / 2).toString(),
      startPreset: "now",
    };
  }

  function normalizeAmount(amount: FeeAmountDraft): FeeAmountDraft {
    if (amount.kind === "fixed") {
      return { kind: "fixed", percentage: amount.percentage };
    }
    if (amount.kind === "scheduled") {
      return {
        kind: "scheduled",
        startDateTime: amount.startDateTime || nowDateTimeLocal(),
        durationHours: amount.durationHours ?? "1",
        durationMinutes: amount.durationMinutes ?? "0",
        startPercentage: amount.startPercentage,
        endPercentage: amount.endPercentage,
        startPreset: amount.startPreset ?? "custom",
      };
    }
    throw new Error("Invalid amount kind");
  }

  let {
    accountId,
    initialReceivers = [
      { receiver: "Pool", amount: { kind: "fixed", percentage: "0.1" } },
    ],
    onChange,
  }: Props = $props();

  let nextFeeReceiverId = 0;

  function createFeeReceiverId(): string {
    nextFeeReceiverId += 1;
    return `fee-receiver-${nextFeeReceiverId}`;
  }

  function isAccountReceiver(
    receiver: XykFeeReceiver,
  ): receiver is { Account: string } {
    return typeof receiver !== "string" && "Account" in receiver;
  }

  function toFormItem(draft: FeeReceiverDraft): FeeReceiverFormItem {
    return {
      id: createFeeReceiverId(),
      receiver: draft.receiver,
      amount: normalizeAmount(draft.amount),
      isValid: draft.receiver === "Pool" ? true : null,
      isChecking: false,
      warning: null,
      validationRequestId: 0,
    };
  }

  function createEmptyAccountReceiver(): FeeReceiverFormItem {
    return {
      id: createFeeReceiverId(),
      receiver: { Account: "" },
      amount: { kind: "fixed", percentage: "0" },
      isValid: null,
      isChecking: false,
      warning: null,
      validationRequestId: 0,
    };
  }

  function isScheduledDurationValid(amount: FeeAmountDraft): boolean {
    if (amount.kind !== "scheduled") return true;
    const durationNs = getScheduledDurationNs(amount);
    return durationNs !== null;
  }

  function isScheduledStartValid(amount: FeeAmountDraft): boolean {
    if (amount.kind !== "scheduled") return true;
    const start = getEffectiveStartTimestampNs(amount, nowTimestampNs);
    return start !== null;
  }

  function isScheduledFeeDecreasing(amount: FeeAmountDraft): boolean {
    if (amount.kind !== "scheduled") return true;
    const startPercentage = parsePercentage(amount.startPercentage);
    const endPercentage = parsePercentage(amount.endPercentage);
    return (
      startPercentage !== null &&
      endPercentage !== null &&
      endPercentage < startPercentage
    );
  }

  function getScheduledFeeChartPoints(
    amount: FeeAmountDraft,
    nowNs: number,
  ): ScheduledFeeChartPoint[] | null {
    if (amount.kind !== "scheduled") return null;
    const startFee = parsePercentage(amount.startPercentage);
    const endFee = parsePercentage(amount.endPercentage);
    const durationNs = getScheduledDurationNs(amount);
    const startNs = getEffectiveStartTimestampNs(amount, nowNs);
    if (
      startFee === null ||
      endFee === null ||
      durationNs === null ||
      startNs === null
    ) {
      return null;
    }
    const endNs = startNs + durationNs;
    if (endNs <= startNs) return null;
    return [
      {
        timestampNanos: startNs,
        feePercent: startFee,
      },
      {
        timestampNanos: endNs,
        feePercent: endFee,
      },
    ];
  }

  function isAmountValid(amount: FeeAmountDraft): boolean {
    if (amount.kind === "fixed") {
      const fixedPercentage = parsePercentage(amount.percentage);
      return fixedPercentage !== null && fixedPercentage >= 0;
    }
    const startPercentage = parsePercentage(amount.startPercentage);
    const endPercentage = parsePercentage(amount.endPercentage);
    return (
      startPercentage !== null &&
      startPercentage >= 0 &&
      endPercentage !== null &&
      endPercentage >= 0 &&
      isScheduledStartValid(amount) &&
      isScheduledDurationValid(amount) &&
      isScheduledFeeDecreasing(amount)
    );
  }

  function getAmountMaxPercentage(amount: FeeAmountDraft): number {
    if (amount.kind === "fixed") {
      return parsePercentage(amount.percentage) ?? 0;
    }
    if (amount.kind === "scheduled") {
      return parsePercentage(amount.startPercentage) ?? 0;
    }
    throw new Error("Invalid amount kind");
  }

  let feeReceivers = $state<FeeReceiverFormItem[]>([]);
  let hasInitialized = $state(false);
  let nowTimestampNs = $state(Date.now() * 1_000_000);

  $effect(() => {
    if (hasInitialized) return;
    feeReceivers = initialReceivers.map(toFormItem);
    hasInitialized = true;

    feeReceivers.forEach((item, index) => {
      if (isAccountReceiver(item.receiver)) {
        validateAccount(index);
      }
    });
  });

  $effect(() => {
    const hasNowStart = feeReceivers.some(
      (item) =>
        item.amount.kind === "scheduled" && item.amount.startPreset === "now",
    );
    if (!hasNowStart) return;

    nowTimestampNs = Date.now() * 1_000_000;
    const timer = setInterval(() => {
      nowTimestampNs = Date.now() * 1_000_000;
    }, 1000);
    return () => clearInterval(timer);
  });

  function addFeeReceiver() {
    feeReceivers = [...feeReceivers, createEmptyAccountReceiver()];
  }

  function removeFeeReceiver(index: number) {
    feeReceivers = feeReceivers.filter((_, i) => i !== index);
  }

  function setReceiverType(index: number, type: "account" | "pool") {
    const current = feeReceivers[index];
    if (!current) return;

    if (type === "pool") {
      feeReceivers[index] = {
        receiver: "Pool",
        amount: current.amount,
        isValid: true,
        isChecking: false,
        warning: null,
        id: current.id,
        validationRequestId: current.validationRequestId + 1,
      };
    } else {
      feeReceivers[index] = {
        receiver: { Account: "" },
        amount: current.amount,
        isValid: null,
        isChecking: false,
        warning: null,
        id: current.id,
        validationRequestId: current.validationRequestId + 1,
      };
    }
    feeReceivers = [...feeReceivers];
  }

  function setMyWallet(index: number) {
    if (!accountId) return;
    const current = feeReceivers[index];
    if (!current) return;

    feeReceivers[index] = {
      receiver: { Account: accountId },
      amount: current.amount,
      isValid: true,
      isChecking: false,
      warning: null,
      id: current.id,
      validationRequestId: current.validationRequestId + 1,
    };
    feeReceivers = [...feeReceivers];
    validateAccount(index);
  }

  function setAmountType(index: number, amountKind: "fixed" | "scheduled") {
    const item = feeReceivers[index];
    if (!item || item.amount.kind === amountKind) return;

    if (amountKind === "fixed") {
      const percentage =
        item.amount.kind === "scheduled"
          ? (parseFloat(item.amount.startPercentage) / 2).toString()
          : item.amount.percentage;
      feeReceivers[index] = {
        ...item,
        amount: { kind: "fixed", percentage },
      };
    } else if (amountKind === "scheduled") {
      const percentage =
        item.amount.kind === "fixed" ? item.amount.percentage : "0";
      feeReceivers[index] = {
        ...item,
        amount: createDefaultScheduledFee(percentage),
      };
    } else {
      throw new Error("Invalid amount kind");
    }
    feeReceivers = [...feeReceivers];
  }

  function applyValidationResult(
    receiverId: string,
    accountValue: string,
    requestId: number,
    state: Pick<FeeReceiverFormItem, "isValid" | "isChecking" | "warning">,
  ): boolean {
    const currentIndex = feeReceivers.findIndex((entry) => entry.id === receiverId);
    if (currentIndex === -1) return false;

    const current = feeReceivers[currentIndex];
    if (
      !isAccountReceiver(current.receiver) ||
      current.receiver.Account !== accountValue
    ) {
      return false;
    }

    if (!state.isChecking && current.validationRequestId > requestId) {
      return false;
    }

    feeReceivers[currentIndex] = {
      ...current,
      ...state,
      validationRequestId: requestId,
    };
    feeReceivers = [...feeReceivers];
    return true;
  }

  async function validateAccount(index: number) {
    const item = feeReceivers[index];
    if (!item || !isAccountReceiver(item.receiver)) return;

    const receiverId = item.id;
    const accountValue = item.receiver.Account;
    const requestId = item.validationRequestId + 1;

    if (accountId && accountValue === accountId) {
      applyValidationResult(receiverId, accountValue, requestId, {
        isValid: true,
        isChecking: false,
        warning: null,
      });
      return;
    }

    const didMarkPending = applyValidationResult(
      receiverId,
      accountValue,
      requestId,
      {
        isValid: null,
        isChecking: true,
        warning: null,
      },
    );
    if (!didMarkPending) return;

    try {
      const data = await tokenHubStore.fetchAccountTokens(accountValue);
      const nearToken = data.find(
        (t: { token: { account_id: string }; balance: string }) =>
          t.token.account_id === "near",
      );
      const nearBalance = nearToken ? parseFloat(nearToken.balance) : 0;
      const warning = nearBalance === 0 ? `${accountValue} has 0 NEAR` : null;
      applyValidationResult(receiverId, accountValue, requestId, {
        isValid: true,
        isChecking: false,
        warning,
      });
    } catch {
      applyValidationResult(receiverId, accountValue, requestId, {
        isValid: false,
        isChecking: false,
        warning: null,
      });
    }
  }

  function updateReceiverValue(index: number, value: string) {
    const item = feeReceivers[index];
    if (!item) return;
    feeReceivers[index] = {
      ...item,
      receiver: { Account: value },
      isValid: null,
      isChecking: false,
      warning: null,
      validationRequestId: item.validationRequestId + 1,
    };
    feeReceivers = [...feeReceivers];

    if (value) {
      validateAccount(index);
    }
  }

  function updateFixedPercentage(index: number, percentage: string) {
    const item = feeReceivers[index];
    if (!item || item.amount.kind !== "fixed") return;
    const normalized = normalizePercentageInput(percentage);

    feeReceivers[index] = {
      ...item,
      amount: { kind: "fixed", percentage: normalized },
    };
    feeReceivers = [...feeReceivers];
  }

  function updateScheduledDateTime(
    index: number,
    field: "startDateTime",
    value: string,
  ) {
    const item = feeReceivers[index];
    if (!item || item.amount.kind !== "scheduled") return;

    feeReceivers[index] = {
      ...item,
      amount: {
        ...item.amount,
        [field]: value,
        startPreset: "custom",
      },
    };
    feeReceivers = [...feeReceivers];
  }

  function updateScheduledPercentage(
    index: number,
    field: "startPercentage" | "endPercentage",
    value: string,
  ) {
    const item = feeReceivers[index];
    if (!item || item.amount.kind !== "scheduled") return;
    const normalized = normalizePercentageInput(value);

    feeReceivers[index] = {
      ...item,
      amount: {
        ...item.amount,
        [field]: normalized,
      },
    };
    feeReceivers = [...feeReceivers];
  }

  function updateScheduledDuration(
    index: number,
    field: "durationHours" | "durationMinutes",
    value: string,
  ) {
    const item = feeReceivers[index];
    if (!item || item.amount.kind !== "scheduled") return;

    feeReceivers[index] = {
      ...item,
      amount: {
        ...item.amount,
        [field]: value,
      },
    };
    feeReceivers = [...feeReceivers];
  }

  function setStartNow(index: number) {
    const item = feeReceivers[index];
    if (!item || item.amount.kind !== "scheduled") return;
    const currentNow = timestampNanosToDateTimeLocal(nowTimestampNs);
    const nextPreset = item.amount.startPreset === "now" ? "custom" : "now";

    feeReceivers[index] = {
      ...item,
      amount: {
        ...item.amount,
        startDateTime: currentNow,
        startPreset: nextPreset,
      },
    };
    feeReceivers = [...feeReceivers];
  }

  const hasDuplicateReceivers = $derived.by(() => {
    const seen = new Set<string>();
    for (const item of feeReceivers) {
      let key: string;
      if (item.receiver === "Pool") {
        key = "pool";
      } else {
        const acc = item.receiver.Account;
        if (!acc) continue;
        key = `account:${acc}`;
      }
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  });

  const totalFeePercentage = $derived.by(() =>
    feeReceivers.reduce(
      (sum, item) => sum + getAmountMaxPercentage(item.amount),
      0,
    ),
  );
  const hasScheduledAmounts = $derived.by(() =>
    feeReceivers.some((item) => item.amount.kind === "scheduled"),
  );

  const isFeeValid = $derived(totalFeePercentage < 50);

  const hasScheduledDurationError = $derived.by(() =>
    feeReceivers.some(
      (item) =>
        item.amount.kind === "scheduled" &&
        !isScheduledDurationValid(item.amount),
    ),
  );

  const hasScheduledFeeDirectionError = $derived.by(() =>
    feeReceivers.some(
      (item) =>
        item.amount.kind === "scheduled" &&
        !isScheduledFeeDecreasing(item.amount),
    ),
  );

  const areAllReceiversValid = $derived.by(() =>
    feeReceivers.every((item) => {
      if (item.receiver === "Pool") {
        return isAmountValid(item.amount);
      }
      return (
        item.isValid === true &&
        isAmountValid(item.amount)
      );
    }),
  );

  $effect(() => {
    onChange({
      receivers: feeReceivers.map((item) => ({
        receiver: item.receiver,
        amount: item.amount,
      })),
      totalFeePercentage,
      isFeeValid,
      hasDuplicateReceivers,
      areAllReceiversValid,
      hasScheduledDurationError,
      hasScheduledFeeDirectionError,
    });
  });
</script>

<div class="section">
  <div class="section-header">
    <h3>Fee Receivers</h3>
    <span class="total-fee"
      >{hasScheduledAmounts ? "Max total" : "Total"}: {totalFeePercentage.toFixed(4)}%</span
    >
  </div>

  <div class="fee-receivers">
    {#each feeReceivers as item, index (item.id)}
      <div class="fee-receiver" transition:fly={{ y: -10, duration: 150 }}>
        <div class="fee-entry">
          <div class="receiver-row">
            <div class="receiver-type">
              <button
                type="button"
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

            <div class="receiver-target">
              {#if isAccountReceiver(item.receiver)}
                <div class="account-input-wrapper">
                  <input
                    type="text"
                    placeholder="you.near"
                    aria-label={`Fee receiver ${index + 1} account`}
                    aria-describedby={item.warning
                      ? `receiver-warning-${index}`
                      : undefined}
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
                        type="button"
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

            <button
              type="button"
              class="remove-btn"
              onclick={() => removeFeeReceiver(index)}
              aria-label="Remove receiver"
            >
              <X size={16} />
            </button>
          </div>

          <div class="amount-row">
            <div class="amount-type-toggle">
              <button
                type="button"
                class="amount-type-btn"
                class:active={item.amount.kind === "fixed"}
                onclick={() => setAmountType(index, "fixed")}
              >
                Fixed
              </button>
              <button
                type="button"
                class="amount-type-btn"
                class:active={item.amount.kind === "scheduled"}
                onclick={() => setAmountType(index, "scheduled")}
              >
                Scheduled
              </button>
            </div>

            {#if item.amount.kind === "fixed"}
              <div class="receiver-percentage fixed-percentage">
                <input
                  type="number"
                  placeholder="0"
                  aria-label={`Fee receiver ${index + 1} fixed percentage`}
                  value={item.amount.percentage}
                  oninput={(e) =>
                    updateFixedPercentage(index, e.currentTarget.value)}
                  min="0"
                  max="100"
                  step="0.0001"
                />
                <span class="percent-sign">%</span>
              </div>
            {/if}
          </div>

          {#if item.amount.kind === "scheduled"}
            <div class="scheduled-grid">
              <div class="scheduled-field">
                <label class="scheduled-label" for={`fee-start-time-${index}`}
                  >Start</label
                >
                <div class="datetime-input-row">
                  <input
                    id={`fee-start-time-${index}`}
                    type="datetime-local"
                    aria-label={`Fee receiver ${index + 1} start datetime`}
                    value={item.amount.startPreset === "now"
                      ? timestampNanosToDateTimeLocal(nowTimestampNs)
                      : item.amount.startDateTime}
                    oninput={(e) =>
                      updateScheduledDateTime(
                        index,
                        "startDateTime",
                        e.currentTarget.value,
                      )}
                    step="1"
                  />
                  <button
                    type="button"
                    class="quick-time-btn"
                    class:active={item.amount.startPreset === "now"}
                    onclick={() => setStartNow(index)}
                  >
                    Now
                  </button>
                </div>
              </div>

              <div class="scheduled-field">
                <label
                  class="scheduled-label"
                  for={`fee-duration-hours-${index}`}>Duration</label
                >
                <div class="duration-input-row">
                  <div class="duration-input-combined">
                    <div class="duration-input-wrapper">
                      <input
                        id={`fee-duration-hours-${index}`}
                        type="number"
                        aria-label={`Fee receiver ${index + 1} duration hours`}
                        placeholder="0"
                        min="0"
                        step="1"
                        value={item.amount.durationHours}
                        oninput={(e) =>
                          updateScheduledDuration(
                            index,
                            "durationHours",
                            e.currentTarget.value,
                          )}
                      />
                      <span>h</span>
                    </div>
                    <div class="duration-input-divider" aria-hidden="true"></div>
                    <div class="duration-input-wrapper">
                      <input
                        id={`fee-duration-minutes-${index}`}
                        type="number"
                        aria-label={`Fee receiver ${index + 1} duration minutes`}
                        placeholder="0"
                        min="0"
                        max="59"
                        step="1"
                        value={item.amount.durationMinutes}
                        oninput={(e) =>
                          updateScheduledDuration(
                            index,
                            "durationMinutes",
                            e.currentTarget.value,
                          )}
                      />
                      <span>m</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="scheduled-fee-row">
                <div class="receiver-percentage scheduled-percentage">
                  <input
                    type="number"
                    placeholder="0"
                    aria-label={`Fee receiver ${index + 1} start percentage`}
                    value={item.amount.startPercentage}
                    oninput={(e) =>
                      updateScheduledPercentage(
                        index,
                        "startPercentage",
                        e.currentTarget.value,
                      )}
                    min="0"
                    max="100"
                    step="0.0001"
                  />
                  <span class="percent-sign">%</span>
                </div>

                <div class="scheduled-fee-separator" aria-hidden="true">
                  <ArrowRight size={16} class="fee-separator-right" />
                </div>

                <div class="receiver-percentage scheduled-percentage">
                  <input
                    type="number"
                    placeholder="0"
                    aria-label={`Fee receiver ${index + 1} end percentage`}
                    value={item.amount.endPercentage}
                    oninput={(e) =>
                      updateScheduledPercentage(
                        index,
                        "endPercentage",
                        e.currentTarget.value,
                      )}
                    min="0"
                    max="100"
                    step="0.0001"
                  />
                  <span class="percent-sign">%</span>
                </div>
              </div>
            </div>

            {@const scheduledChartPoints = getScheduledFeeChartPoints(
              item.amount,
              nowTimestampNs,
            )}
            {#if scheduledChartPoints}
              <ScheduledFeeChart
                points={scheduledChartPoints}
                currentTimestampNanos={nowTimestampNs}
              />
            {/if}
          {/if}
        </div>

        {#if isAccountReceiver(item.receiver) && item.warning}
          <p id={`receiver-warning-${index}`} class="warning-text">
            {item.warning}
          </p>
        {/if}
      </div>
    {/each}
  </div>

  <button type="button" class="add-receiver-btn" onclick={addFeeReceiver}>
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
    gap: 0.75rem;
  }

  .fee-receiver {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .fee-entry {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.625rem;
  }

  .receiver-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
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
  }

  .remove-btn:hover {
    color: #ef4444;
  }

  .amount-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-color);
  }

  .amount-type-toggle {
    display: inline-flex;
    width: fit-content;
    padding: 0.125rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  .amount-type-btn {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.3rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 999px;
    transition: all 0.15s ease;
  }

  .amount-type-btn:hover {
    color: var(--text-primary);
  }

  .amount-type-btn.active {
    background: var(--accent-button-small);
    color: white;
  }

  .receiver-percentage {
    position: relative;
    width: 100%;
    max-width: 100%;
  }

  .fixed-percentage {
    flex: 1;
    min-width: 0;
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

  .scheduled-grid {
    display: grid;
    grid-template-columns: minmax(0, 8fr) minmax(0, 3fr);
    gap: 0.75rem 1.4rem;
    padding-top: 0.25rem;
  }

  .scheduled-field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-width: 0;
  }

  .scheduled-fee-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
  }

  .scheduled-fee-row .receiver-percentage {
    min-width: 0;
  }

  .scheduled-fee-separator {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .scheduled-fee-separator :global(.fee-separator-right) {
    display: block;
  }

  .scheduled-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .datetime-input-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .datetime-input-row input {
    flex: 1;
    min-width: 0;
    height: 2.25rem;
    padding: 0 0.625rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-size: 0.8125rem;
    transition: border-color 0.15s ease;
  }

  .datetime-input-row input:focus {
    border-color: var(--accent-primary);
  }

  .datetime-input-row input:focus-visible {
    outline: none;
  }

  .quick-time-btn {
    height: 2.25rem;
    padding: 0 0.65rem;
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .quick-time-btn:hover {
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }

  .quick-time-btn.active {
    background: var(--accent-button-small);
    border-color: var(--accent-primary);
    color: white;
  }

  .quick-time-btn.active:hover {
    background: var(--accent-hover);
    color: white;
  }

  .duration-input-row {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .duration-input-combined {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    height: 2.25rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    overflow: hidden;
    transition: border-color 0.15s ease;
  }

  .duration-input-combined:focus-within {
    border-color: var(--accent-primary);
  }

  .duration-input-divider {
    width: 1px;
    align-self: stretch;
    background: var(--border-color);
  }

  .duration-input-wrapper {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    height: 100%;
    padding: 0 0.625rem;
    background: transparent;
    border: none;
  }

  .duration-input-wrapper input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: "JetBrains Mono", monospace;
    text-align: right;
  }

  .duration-input-wrapper input:focus-visible {
    outline: none;
  }

  .duration-input-wrapper span {
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .scheduled-percentage {
    width: 100%;
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

    .receiver-target {
      width: 100%;
    }

    .amount-row {
      flex-wrap: wrap;
    }

    .scheduled-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (--mobile) {
    .type-selector:not(.is-pool) span {
      display: none;
    }

    .account-input-wrapper input {
      padding-left: 0.5rem;
    }
  }

  @media (max-width: 360px) {
    .fee-entry {
      padding: 0.375rem;
    }

    .scheduled-grid {
      gap: 0.5rem;
    }

    .datetime-input-row {
      flex-wrap: wrap;
      gap: 0.375rem;
    }

    .datetime-input-row input {
      width: 100%;
      flex-basis: 100%;
      font-size: 0.75rem;
    }

    .quick-time-btn {
      width: 100%;
      height: 2rem;
      font-size: 0.7rem;
      padding: 0 0.5rem;
    }

    .duration-input-row {
      gap: 0;
    }

    .duration-input-combined {
      height: 2.1rem;
    }

    .duration-input-wrapper {
      padding: 0 0.5rem;
    }

    .duration-input-wrapper input {
      font-size: 0.8125rem;
    }

    .scheduled-fee-row {
      gap: 0.35rem;
    }

    .scheduled-fee-separator :global(.fee-separator-right) {
      width: 14px;
      height: 14px;
    }

    .receiver-percentage input {
      padding: 0 1.2rem 0 0.45rem;
      font-size: 0.8125rem;
    }
  }

  @media (max-width: 300px) {
    .duration-input-combined {
      width: 100%;
    }
  }
</style>
