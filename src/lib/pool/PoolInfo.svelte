<script lang="ts">
  import TokenIcon from "../TokenIcon.svelte";
  import { LoaderCircle } from "lucide-svelte";
  import type { NormalizedPool, Token } from "../types";
  import { walletStore } from "../walletStore";
  import PoolFeeBreakdown from "./PoolFeeBreakdown.svelte";
  import {
    DEX_CONTRACT_ID,
    DEX_ID,
    assertOutcomesSucceeded,
  } from "./shared";
  import { formatApy, formatLiquidity } from "../utils";
  import {
    XykLockPoolArgsSchema,
    XykUpgradePoolArgsSchema,
    serializeToBase64,
    type ArgsXykLockPool,
    type ArgsXykUpgradePool,
  } from "../xykSchemas";

  interface Props {
    poolData: NormalizedPool | null;
    liquidityUsd: number;
    volume7dUsd: number;
    apyPercent: number;
    farmApyPercent: number | null;
    token0: Token | null;
    token1: Token | null;
    poolId: number | null;
    accountId: string | null;
    needsUpgrade: boolean;
    onEditFees: () => void;
    onLocked: () => void;
  }

  let {
    poolData,
    liquidityUsd,
    volume7dUsd,
    apyPercent,
    farmApyPercent,
    token0,
    token1,
    poolId,
    accountId,
    needsUpgrade,
    onEditFees,
    onLocked,
  }: Props = $props();

  const isPrivate = $derived(poolData?.ownerId !== null);
  const isOwner = $derived(
    !!poolData?.ownerId && poolData.ownerId === accountId,
  );
  const isLocked = $derived(poolData?.locked ?? false);

  let showLockModal = $state(false);
  let isLocking = $state(false);
  let lockError = $state<string | null>(null);

  function openLockModal() {
    lockError = null;
    showLockModal = true;
  }

  function closeLockModal() {
    if (isLocking) return;
    showLockModal = false;
  }

  function handleLockBackdropKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      closeLockModal();
    }
  }

  async function confirmLockPool() {
    const wallet = $walletStore.wallet;
    if (!wallet) {
      lockError = "Please connect your wallet";
      return;
    }
    if (poolId === null) {
      lockError = "Pool ID is missing";
      return;
    }

    isLocking = true;
    lockError = null;
    try {
      const lockArgsObject: ArgsXykLockPool = { pool_id: poolId };
      const lockArgs = serializeToBase64(XykLockPoolArgsSchema, lockArgsObject);

      let deposit = BigInt(0);
      const operations = [
        {
          DexCall: {
            dex_id: DEX_ID,
            method: "lock_pool",
            args: lockArgs,
            attached_assets: {},
          },
        },
      ];

      if (needsUpgrade) {
        const upgradeArgsObject: ArgsXykUpgradePool = {
          pool_id: poolId,
        };
        const upgradeArgs = serializeToBase64(
          XykUpgradePoolArgsSchema,
          upgradeArgsObject,
        );
        const upgradeDeposit = BigInt("3" + "0".repeat(24 - 3)); // 0.003 NEAR
        operations.unshift({
          DexCall: {
            dex_id: DEX_ID,
            method: "upgrade_pool",
            args: upgradeArgs,
            attached_assets: {
              near: upgradeDeposit.toString(),
            } as Record<string, string>,
          },
        });
        deposit += upgradeDeposit;
      }

      const transactions = [
        {
          receiverId: DEX_CONTRACT_ID,
          actions: [
            {
              type: "FunctionCall" as const,
              params: {
                methodName: "execute_operations",
                args: { operations },
                gas: "120" + "0".repeat(12),
                deposit: deposit == BigInt(0) ? "1" : deposit.toString(),
              },
            },
          ],
        },
      ];

      const outcomes = await wallet.signAndSendTransactions({ transactions });
      assertOutcomesSucceeded(outcomes);
      showLockModal = false;
      onLocked();
    } catch (error) {
      lockError =
        error instanceof Error ? error.message : "Failed to lock pool";
    } finally {
      isLocking = false;
    }
  }
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
      {#if isLocked}
        <span class="burnt-badge">Burnt</span>
      {/if}
    </div>
  </div>

  <div class="pool-stats">
    <div class="stat-row">
      <span class="stat-label">Liquidity</span>
      <span class="stat-value">{formatLiquidity(liquidityUsd)}</span>
    </div>
    <PoolFeeBreakdown configuration={poolData?.fee_configuration ?? null} />
    {#if isPrivate && isOwner}
      {#if !isLocked}
        <button class="edit-fees-btn" onclick={onEditFees}>Edit Fees</button>
        <button class="lock-pool-btn" onclick={openLockModal}
          >Burn Liquidity</button
        >
      {/if}
    {/if}
    <div class="stat-row">
      <span class="stat-label">7d Avg APY</span>
      <span class="apy-value-stack">
        <span class="stat-value">{formatApy(apyPercent)}</span>
        {#if farmApyPercent !== null}
          <span class="farm-apy-value">+ {formatApy(farmApyPercent)} 🌱</span>
        {/if}
      </span>
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

{#if showLockModal}
  <div
    class="modal-backdrop"
    role="presentation"
    tabindex="-1"
    onclick={closeLockModal}
    onkeydown={handleLockBackdropKeyDown}
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-pool-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="modal-header">
        <h2 id="lock-pool-title">Burn LP</h2>
      </div>
      <div class="modal-body">
        <div class="lock-warning">
          <p>
            Burning LP is permanent. This pool will be locked forever with no
            ability to unlock, and you will not be able to withdraw liquidity.
          </p>
        </div>
        <p class="lock-warning-secondary">
          Confirm only if you are sure you want to burn the liquidity forever.
          Generally this is only done if you're the one launching this token,
          you don't need to do this if you are just a holder.
        </p>
        {#if lockError}
          <p class="lock-error" role="alert" aria-live="assertive">
            {lockError}
          </p>
        {/if}
      </div>
      <div class="modal-footer">
        <button
          class="cancel-btn"
          onclick={closeLockModal}
          disabled={isLocking}
        >
          Cancel
        </button>
        <button
          class="confirm-lock-btn"
          onclick={confirmLockPool}
          disabled={isLocking}
        >
          {#if isLocking}
            <LoaderCircle size={16} class="spinning" />
            Burning...
          {:else}
            Burn LP Forever
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

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
  .owner-badge,
  .burnt-badge {
    font-size: 0.625rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .private-badge {
    color: var(--status-warning-text);
    background: var(--status-warning-soft-bg);
  }

  .owner-badge {
    color: var(--status-success-text);
    background: var(--status-success-soft-bg);
  }

  .burnt-badge {
    color: var(--status-error-text);
    background: var(--status-error-soft-bg);
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

  .apy-value-stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.125rem;
  }

  .farm-apy-value {
    color: var(--status-success-text);
    font-size: 0.75rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
  }

  .owner-id {
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    color: var(--text-on-accent);
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .edit-fees-btn:hover {
    background: var(--accent-hover);
  }

  .lock-pool-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.52rem 1rem;
    background: var(--status-error-soft-bg);
    border: 1px solid var(--status-error-soft-border);
    border-radius: 0.5rem;
    color: var(--status-error-soft-text);
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .lock-pool-btn:hover {
    background: color-mix(in oklab, var(--status-error-soft-bg), black 8%);
    border-color: color-mix(in oklab, var(--status-error-soft-border), black 8%);
  }

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
    max-width: 460px;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1.25rem;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border-color);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 1.25rem 1.5rem;
  }

  .lock-warning {
    display: flex;
    gap: 0.625rem;
    padding: 0.875rem;
    border-radius: 0.75rem;
    background: var(--status-error-soft-bg);
    border: 1px solid var(--status-error-soft-border);
    color: var(--status-error-soft-text);
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .lock-warning p,
  .lock-warning-secondary {
    margin: 0;
  }

  .lock-warning-secondary {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .lock-error {
    margin: 0;
    color: var(--status-error-text);
    font-size: 0.8125rem;
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    padding: 1rem 1.5rem 1.25rem;
    border-top: 1px solid var(--border-color);
  }

  .cancel-btn,
  .confirm-lock-btn {
    flex: 1;
    padding: 0.75rem 1rem;
    border-radius: 0.625rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .cancel-btn {
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .cancel-btn:hover:not(:disabled) {
    background: var(--bg-input);
  }

  .confirm-lock-btn {
    border: none;
    background: linear-gradient(
      135deg,
      var(--status-error-solid) 0%,
      var(--status-error-solid-hover) 100%
    );
    color: var(--text-on-danger);
  }

  .confirm-lock-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }

  .cancel-btn:disabled,
  .confirm-lock-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .confirm-lock-btn :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (--mobile) {
    .owner-id {
      max-width: 10rem;
    }

    .modal-backdrop {
      align-items: flex-end;
      padding: 0;
    }

    .modal {
      max-width: 100%;
      border-radius: 1.25rem 1.25rem 0 0;
      border-bottom: none;
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
    .owner-badge,
    .burnt-badge {
      font-size: 0.5625rem;
      padding: 0.1875rem 0.375rem;
    }
  }
</style>
