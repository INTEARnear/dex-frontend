<script lang="ts">
  import { onDestroy } from "svelte";
  import { createChatwootModalVisibilityController } from "../chatwootBubbleVisibility";
  import type { Token } from "../types";
  import { formatAmount, rawAmountToHumanReadable } from "../utils";
  import ModalShell from "../ModalShell.svelte";
  import type { LiquidityAddedEventData } from "./liquidityEvents";

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    eventData: LiquidityAddedEventData | null;
    token0: Token | null;
    token1: Token | null;
    isPrivatePool: boolean;
  }

  let { isOpen, onClose, eventData, token0, token1, isPrivatePool }: Props =
    $props();

  const chatwootModalVisibility = createChatwootModalVisibilityController();

  onDestroy(() => {
    chatwootModalVisibility.dispose();
  });

  $effect(() => {
    chatwootModalVisibility.setVisible(isOpen);
  });

  const requiredTokens = $derived.by(() => {
    if (!isOpen || !eventData || !token0 || !token1) return null;
    return { token0, token1 };
  });
  const decimals0 = $derived(requiredTokens?.token0.metadata.decimals ?? 0);
  const decimals1 = $derived(requiredTokens?.token1.metadata.decimals ?? 0);
  const symbol0 = $derived(requiredTokens?.token0.metadata.symbol ?? "");
  const symbol1 = $derived(requiredTokens?.token1.metadata.symbol ?? "");

  const poolSharePercent = $derived.by(() => {
    if (!eventData || isPrivatePool || !eventData.new_total_shares) return null;
    const owned = BigInt(eventData.new_owned_shares);
    const total = BigInt(eventData.new_total_shares);
    if (total <= 0n) return null;
    return Number((owned * 1000000n) / total) / 10000;
  });

  const added0HumanReadable = $derived(
    eventData
      ? rawAmountToHumanReadable(eventData.added_amount_0, decimals0)
      : null,
  );
  const added1HumanReadable = $derived(
    eventData
      ? rawAmountToHumanReadable(eventData.added_amount_1, decimals1)
      : null,
  );
</script>

<ModalShell
  isOpen={!!(isOpen && eventData)}
  {onClose}
  modalClassName="success-modal"
  dialogLabel="Liquidity added"
>
  <div class="modal-icon success-icon">
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  </div>
  <h3 class="modal-title">Liquidity Added</h3>

  {#if poolSharePercent !== null && poolSharePercent > 0}
    <div class="info-row">
      <span class="info-label">Your pool share</span>
      <span class="info-value">{formatAmount(poolSharePercent)}%</span>
    </div>
  {/if}

  <div class="tokens-added">
    <span class="tokens-label">Added to pool</span>
    <div class="token-row">
      <span class="token-amount"
        >{added0HumanReadable !== null
          ? formatAmount(parseFloat(added0HumanReadable))
          : "—"}</span
      >
      <span class="token-symbol">{symbol0}</span>
    </div>
    <div class="token-row">
      <span class="token-amount"
        >{added1HumanReadable !== null
          ? formatAmount(parseFloat(added1HumanReadable))
          : "—"}</span
      >
      <span class="token-symbol">{symbol1}</span>
    </div>
  </div>

  <button class="modal-btn success-btn" onclick={onClose}>Done</button>
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

  .success-icon {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }

  .modal-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--bg-input);
    border-radius: 0.5rem;
  }

  .info-label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .info-value {
    font-size: 1rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
    color: var(--text-primary);
  }

  .tokens-added {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    padding: 0.75rem;
    background: var(--bg-input);
    border-radius: 0.75rem;
  }

  .tokens-label {
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .token-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .token-amount {
    font-size: 1rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
    color: var(--text-primary);
  }

  .token-symbol {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .modal-btn {
    width: 100%;
    padding: 0.875rem;
    margin-top: 0.5rem;
  }

  .success-btn {
    background: linear-gradient(135deg, #22c55e, #16a34a);
    border: none;
    color: white;
    border-radius: 0.75rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .success-btn:hover {
    background: linear-gradient(135deg, #16a34a, #15803d);
  }
</style>
