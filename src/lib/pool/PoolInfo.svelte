<script lang="ts">
  import TokenIcon from "../TokenIcon.svelte";
  import type { NormalizedPool, Token } from "../types";
  import {
    calculatePoolFeesApyPercent,
    getPoolFeeFractionDecimal,
  } from "./shared";
  import { formatApy, formatFeePercent, formatLiquidity } from "../utils";

  interface Props {
    poolData: NormalizedPool | null;
    volume24hUsd: number;
    volume7dUsd: number;
    token0: Token | null;
    token1: Token | null;
    poolId: number | null;
    accountId: string | null;
    onEditFees: () => void;
  }

  let {
    poolData,
    volume24hUsd,
    volume7dUsd,
    token0,
    token1,
    poolId,
    accountId,
    onEditFees,
  }: Props = $props();

  const liquidityUsd = $derived.by(() => {
    if (!poolData || !token0 || !token1) return 0;
    const amount0 =
      parseFloat(poolData.assets[0].balance) /
      Math.pow(10, token0.metadata.decimals);
    const amount1 =
      parseFloat(poolData.assets[1].balance) /
      Math.pow(10, token1.metadata.decimals);
    const price0 = parseFloat(token0.price_usd || "0");
    const price1 = parseFloat(token1.price_usd || "0");
    return amount0 * price0 + amount1 * price1;
  });

  function shouldDisplayFeeReceiver(receiver: unknown): boolean {
    if (typeof receiver === "object" && receiver !== null && "Account" in receiver) {
      return receiver.Account !== "plach.intear.near";
    }
    return true;
  }

  const totalFeePercent = $derived.by(() => {
    if (!poolData) return 0;
    return (
      poolData.fees.receivers
        .filter(([receiver,]) => shouldDisplayFeeReceiver(receiver))
        .reduce((acc, [, amount]) => acc + amount, 0) / 10000
    );
  });

  const feeBreakdown = $derived.by(() => {
    if (!poolData) return [];
    const feeByReceiver = new Map<string, number>();
    for (const [receiver, amount] of poolData.fees.receivers) {
      if (!shouldDisplayFeeReceiver(receiver)) continue;
      const receiverLabel =
        receiver === "Pool"
          ? "Pool"
          : receiver.Account;
      feeByReceiver.set(receiverLabel, (feeByReceiver.get(receiverLabel) ?? 0) + amount);
    }
    return Array.from(feeByReceiver, ([receiver, amount]) => ({
      receiver,
      feePercent: amount / 10000,
    }));
  });
  const poolFeeFractionDecimal = $derived.by(() => {
    if (!poolData) return 0;
    return getPoolFeeFractionDecimal(poolData.fees);
  });
  const apyPercent = $derived.by(() =>
    calculatePoolFeesApyPercent(
      volume24hUsd,
      poolFeeFractionDecimal,
      liquidityUsd,
    ),
  );

  const isPrivate = $derived(poolData?.ownerId !== null);
  const isOwner = $derived(
    !!poolData?.ownerId && poolData.ownerId === accountId,
  );
</script>

<aside class="pool-info">
  <div class="sidebar-header">
    <div class="pool-identity">
      <div class="token-icons">
        {#if token0}
          <TokenIcon token={token0} size={48} showBadge ring ringWidth={3} />
        {/if}
        {#if token1}
          <TokenIcon
            token={token1}
            size={48}
            showBadge
            ring
            ringWidth={3}
            overlap
          />
        {/if}
      </div>
      <div class="pair-symbols">
        {token0?.metadata.symbol ?? "?"}-{token1?.metadata.symbol ?? "?"}
      </div>
    </div>
    <div class="pool-badges">
      {#if isPrivate}
        <span class="private-badge">Private</span>
      {/if}
      {#if isOwner}
        <span class="owner-badge">Yours</span>
      {/if}
    </div>
  </div>

  <div class="pool-stats">
    <div class="stat-row">
      <span class="stat-label">Liquidity</span>
      <span class="stat-value">{formatLiquidity(liquidityUsd)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Fee</span>
      <span class="stat-value">{formatFeePercent(totalFeePercent)}%</span>
    </div>
    {#if feeBreakdown.length > 0}
      {#each feeBreakdown as item (item.receiver)}
        <div class="stat-row fee-breakdown-row">
          <span class="stat-label fee-breakdown-label">{item.receiver}</span>
          <span class="stat-value fee-breakdown-value">
            {formatFeePercent(item.feePercent)}%
          </span>
        </div>
      {/each}
    {/if}
    {#if isPrivate && isOwner}
      <button class="edit-fees-btn" onclick={onEditFees}>Edit Fees</button>
    {/if}
    <div class="stat-row">
      <span class="stat-label">APY</span>
      <span class="stat-value">{formatApy(apyPercent)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">7d Volume</span>
      <span class="stat-value">{formatLiquidity(volume7dUsd)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Pool ID</span>
      <span class="stat-value">#{poolId}</span>
    </div>
    {#if poolData?.ownerId}
      <div class="stat-row">
        <span class="stat-label">Owner</span>
        <span class="stat-value owner-id">{poolData.ownerId}</span>
      </div>
    {/if}
  </div>
</aside>

<style>
  .pool-info {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1.25rem;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.3),
      0 2px 4px -2px rgba(0, 0, 0, 0.2),
      0 0 0 1px rgba(59, 130, 246, 0.05);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }

  .pool-identity {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .token-icons {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .token-icons :global(.reputation-reputable),
  .token-icons :global(.reputation-notfake) {
    display: none;
  }

  .pool-badges {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
  }

  .private-badge,
  .owner-badge {
    font-size: 0.625rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .private-badge {
    color: #eab308;
    background: rgba(234, 179, 8, 0.15);
  }

  .owner-badge {
    color: #22c55e;
    background: rgba(34, 197, 94, 0.15);
  }

  .pair-symbols {
    font-size: 1.125rem;
    font-weight: 700;
    word-break: break-all;
    font-family: "JetBrains Mono", monospace;
  }

  .pool-stats {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .stat-label {
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .stat-value {
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
    text-align: right;
  }

  .owner-id {
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fee-breakdown-row {
    padding-left: 0.75rem;
  }

  .fee-breakdown-label {
    font-size: 0.75rem;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fee-breakdown-value {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .edit-fees-btn {
    margin-top: 0.25rem;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.52rem 1rem;
    background: var(--accent-button-small);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .edit-fees-btn:hover {
    background: var(--accent-hover);
  }

  @media (--mobile) {
    .owner-id {
      max-width: 10rem;
    }
  }

  @media (--small-mobile) {
    .pool-info {
      padding: 0.75rem;
    }

    .pair-symbols {
      font-size: 1rem;
    }

    .pool-stats {
      gap: 0.375rem;
    }

    .stat-label {
      font-size: 0.75rem;
    }

    .stat-value {
      font-size: 0.8125rem;
    }

    .owner-id {
      max-width: 8rem;
    }

    .private-badge,
    .owner-badge {
      font-size: 0.5625rem;
      padding: 0.1875rem 0.375rem;
    }
  }
</style>
