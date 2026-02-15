<script lang="ts">
  import { onDestroy } from "svelte";
  import { createChatwootModalVisibilityController } from "../chatwootBubbleVisibility";
  import type { Token } from "../types";
  import { formatAmount, rawAmountToHumanReadable } from "../utils";
  import ModalShell from "../ModalShell.svelte";
  import type { LiquidityRemovedEventData } from "./liquidityEvents";

  interface PositionData {
    asset0_amount: string;
    asset1_amount: string;
    asset0_open_price_usd: number;
    asset1_open_price_usd: number;
  }

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    eventData: LiquidityRemovedEventData | null;
    token0: Token | null;
    token1: Token | null;
    positionData?: {
      data: PositionData | null;
      prices: {
        price0Usd: number;
        price1Usd: number;
      } | null;
    };
  }

  let { isOpen, onClose, eventData, token0, token1, positionData }: Props =
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
  const requiredPrices = $derived.by(() => {
    if (!isOpen || !eventData || !positionData) return null;
    return positionData.prices;
  });
  const decimals0 = $derived(requiredTokens?.token0.metadata.decimals ?? 0);
  const decimals1 = $derived(requiredTokens?.token1.metadata.decimals ?? 0);
  const symbol0 = $derived(requiredTokens?.token0.metadata.symbol ?? "");
  const symbol1 = $derived(requiredTokens?.token1.metadata.symbol ?? "");
  const price0 = $derived(requiredPrices?.price0Usd ?? 0);
  const price1 = $derived(requiredPrices?.price1Usd ?? 0);

  const removed0Human = $derived(
    eventData
      ? rawAmountToHumanReadable(eventData.removed_amount_0, decimals0)
      : null,
  );
  const removed1Human = $derived(
    eventData
      ? rawAmountToHumanReadable(eventData.removed_amount_1, decimals1)
      : null,
  );

  const pnlUsd = $derived.by(() => {
    if (!eventData || !positionData || !positionData.data) return null;
    if (!requiredPrices) return null;

    const currentValue =
      parseFloat(removed0Human ?? "0") * price0 +
      parseFloat(removed1Human ?? "0") * price1;

    const amount0Open = parseFloat(
      rawAmountToHumanReadable(positionData.data.asset0_amount, decimals0),
    );
    const amount1Open = parseFloat(
      rawAmountToHumanReadable(positionData.data.asset1_amount, decimals1),
    );
    const openValue =
      amount0Open * positionData.data.asset0_open_price_usd +
      amount1Open * positionData.data.asset1_open_price_usd;

    const pnl = currentValue - openValue;
    return Number.isFinite(pnl) ? pnl : null;
  });
</script>

<ModalShell
  isOpen={!!(isOpen && eventData)}
  {onClose}
  modalClassName="success-modal"
  dialogLabel="Liquidity removed"
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
  <h3 class="modal-title">Liquidity Removed</h3>

  <div class="tokens-received">
    <span class="tokens-label">You received</span>
    <div class="token-row">
      <span class="token-amount"
        >{removed0Human !== null
          ? formatAmount(parseFloat(removed0Human))
          : "—"}</span
      >
      <span class="token-symbol">{symbol0}</span>
    </div>
    <div class="token-row">
      <span class="token-amount"
        >{removed1Human !== null
          ? formatAmount(parseFloat(removed1Human))
          : "—"}</span
      >
      <span class="token-symbol">{symbol1}</span>
    </div>
  </div>

  {#if positionData && pnlUsd !== null}
    <div
      class="pnl-row"
      class:pnl-positive={pnlUsd > 0}
      class:pnl-negative={pnlUsd < 0}
    >
      <span class="pnl-label">PnL</span>
      <span class="pnl-value">
        {pnlUsd >= 0 ? "+" : ""}${formatAmount(pnlUsd)}
      </span>
    </div>
  {/if}

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

  .tokens-received {
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

  .pnl-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    font-family: "JetBrains Mono", monospace;
  }

  .pnl-positive {
    background: rgba(34, 197, 94, 0.12);
    color: #4ade80;
  }

  .pnl-negative {
    background: rgba(239, 68, 68, 0.12);
    color: #f87171;
  }

  .pnl-label {
    font-size: 0.875rem;
  }

  .pnl-value {
    font-size: 1rem;
    font-weight: 700;
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
