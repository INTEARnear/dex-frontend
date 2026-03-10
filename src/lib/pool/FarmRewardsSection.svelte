<script lang="ts">
  import { untrack } from "svelte";
  import Spinner from "../Spinner.svelte";
  import TokenIcon from "../TokenIcon.svelte";
  import { FARM_BLOCK_TIME_MS } from "../farmUtils";
  import { tokenHubStore } from "../tokenHubStore";
  import type { XykFarmReward } from "../types";
  import { DEX_BACKEND_API, rawAmountToHumanReadable } from "../utils";
  import {
    getOrCreateSignatureAuthPayload,
    getStoredSignatureAuthPayload,
    walletStore,
  } from "../walletStore";
  import { assetIdToTokenId } from "./shared";

  interface Props {
    rewards: XykFarmReward[];
    onClaimSuccess: () => Promise<void>;
  }

  interface RewardState {
    farmId: number;
    assetId: string;
    accruedAmount: number;
    rewardPerBlock: number;
    accruedReward: bigint;
  }

  const REWARD_SYNC_THRESHOLD_USD = 0.001;
  const MIN_UNCLAIMED_RAW_FOR_CLAIM = 1000n;

  let { rewards, onClaimSuccess }: Props = $props();
  let rewardStates = $state<RewardState[]>([]);
  let nowMs = $state(Date.now());
  let rewardsSnapshotTimestampMs = $state(Date.now());
  let claimingFarmId = $state<number | null>(null);
  let claimPhase = $state<"signing" | "claiming" | null>(null);
  let claimError = $state<string | null>(null);
  let claimSuccess = $state<string | null>(null);

  function rewardKey(reward: { farmId: number; assetId: string }): string {
    return `${reward.farmId}-${reward.assetId}`;
  }

  function calculateAccruedAmount(
    reward: RewardState,
    elapsedMs: number,
  ): number {
    const elapsedBlocks = Math.max(0, elapsedMs) / FARM_BLOCK_TIME_MS;
    const accrued =
      reward.accruedAmount + reward.rewardPerBlock * elapsedBlocks;
    return accrued > 0 ? accrued : 0;
  }

  $effect(() => {
    rewards;
    const mergeTimestampMs = Date.now();
    const previousSnapshotTimestampMs = untrack(
      () => rewardsSnapshotTimestampMs,
    );
    const elapsedMs = mergeTimestampMs - previousSnapshotTimestampMs;
    const previousRewardStates = untrack(() => rewardStates);
    const previousByKey = new Map<string, RewardState>(
      previousRewardStates.map((reward) => [rewardKey(reward), reward]),
    );
    const nextStates: RewardState[] = [];

    for (const reward of rewards) {
      const key = `${reward.farm_id}-${reward.asset_id}`;
      const previous = previousByKey.get(key);
      const token = tokenHubStore.selectToken(reward.asset_id);
      const decimals = token?.metadata.decimals ?? 0;
      const incomingAccruedBaseAmount =
        decimals > 0
          ? parseFloat(
              rawAmountToHumanReadable(reward.accrued_reward, decimals),
            )
          : 0;
      const incomingRewardPerBlock =
        decimals > 0
          ? parseFloat(reward.your_reward_per_block) / Math.pow(10, decimals)
          : 0;
      let incomingCalculatedAtMs = Date.parse(
        reward.accrued_reward_calculated_at,
      );
      if (incomingCalculatedAtMs !== incomingCalculatedAtMs) {
        incomingCalculatedAtMs = mergeTimestampMs;
      }
      const incomingElapsedMs = Math.max(
        0,
        mergeTimestampMs - incomingCalculatedAtMs,
      );
      const incomingAccruedAmount =
        incomingAccruedBaseAmount +
        incomingRewardPerBlock * (incomingElapsedMs / FARM_BLOCK_TIME_MS);

      if (!previous) {
        nextStates.push({
          farmId: reward.farm_id,
          assetId: reward.asset_id,
          accruedAmount: incomingAccruedAmount,
          rewardPerBlock: incomingRewardPerBlock,
          accruedReward: BigInt(reward.accrued_reward),
        });
        continue;
      }

      const currentAccruedAmount = calculateAccruedAmount(previous, elapsedMs);
      const amountDifference = Math.abs(
        incomingAccruedAmount - currentAccruedAmount,
      );
      const priceUsd = parseFloat(token?.price_usd ?? "0");
      const differenceUsd = amountDifference * priceUsd;

      const shouldReplaceAccrued =
        priceUsd === 0 || differenceUsd > REWARD_SYNC_THRESHOLD_USD;

      nextStates.push({
        farmId: reward.farm_id,
        assetId: reward.asset_id,
        accruedAmount: shouldReplaceAccrued
          ? incomingAccruedAmount
          : currentAccruedAmount,
        rewardPerBlock: incomingRewardPerBlock,
        accruedReward: BigInt(reward.accrued_reward),
      });
    }

    rewardStates = nextStates;
    rewardsSnapshotTimestampMs = mergeTimestampMs;
    nowMs = mergeTimestampMs;
  });

  $effect(() => {
    if (rewardStates.length === 0) return;

    const timer = setInterval(() => {
      nowMs = Date.now();
    }, 100);
    return () => clearInterval(timer);
  });

  const rewardRows = $derived.by(() => {
    const elapsedMs = nowMs - rewardsSnapshotTimestampMs;
    const tokensById = $tokenHubStore.tokensById;

    return rewardStates.map((reward) => {
      const tokenId = assetIdToTokenId(reward.assetId);
      const token = tokenId ? (tokensById[tokenId] ?? null) : null;
      const amount = calculateAccruedAmount(reward, elapsedMs);

      return {
        key: rewardKey(reward),
        farmId: reward.farmId,
        token,
        symbol: token?.metadata.symbol ?? reward.assetId,
        amountLabel: amount.toFixed(4),
        canClaim: reward.accruedReward >= MIN_UNCLAIMED_RAW_FOR_CLAIM,
      };
    });
  });

  async function handleClaimClick(farmId: number, canClaim: boolean) {
    if (claimingFarmId !== null) return;
    if (!canClaim) return;
    const accountId = $walletStore.accountId;
    const wallet = $walletStore.wallet;
    if (!accountId || !wallet) {
      claimError = "Connect wallet first";
      return;
    }

    claimError = null;
    claimSuccess = null;
    claimingFarmId = farmId;
    try {
      const hasStoredPayload =
        getStoredSignatureAuthPayload(accountId) !== null;
      claimPhase = hasStoredPayload ? "claiming" : "signing";
      const { payload } = await getOrCreateSignatureAuthPayload(
        accountId,
        wallet,
      );

      claimPhase = "claiming";
      const response = await fetch(`${DEX_BACKEND_API}/farms/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${JSON.stringify(payload)}`,
        },
        body: JSON.stringify({
          farmId,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(errBody || `HTTP ${response.status}`);
      }

      await onClaimSuccess();
      claimSuccess = "Claimed";
    } catch (error) {
      console.error("Farm claim failed:", error);
      claimError =
        error instanceof Error ? error.message : "Failed to claim farm rewards";
    } finally {
      claimPhase = null;
      claimingFarmId = null;
    }
  }
</script>

<aside class="farm-rewards">
  <div class="farm-rewards-title">Farm Rewards</div>

  {#if rewardRows.length === 0}
    <p class="farm-rewards-empty">No farm rewards.</p>
  {:else}
    <div class="farm-rewards-table-wrap">
      <table class="farm-rewards-table">
        <tbody>
          {#each rewardRows as row (row.key)}
            <tr>
              <td class="token-cell">
                <TokenIcon token={row.token} size={34} />
                <span class="token-symbol">{row.symbol}</span>
              </td>
              <td class="amount-cell">{row.amountLabel}</td>
              <td class="action-cell">
                <button
                  type="button"
                  class="withdraw-btn"
                  onclick={() => handleClaimClick(row.farmId, row.canClaim)}
                  disabled={claimingFarmId !== null ||
                    !$walletStore.isConnected ||
                    !row.canClaim}
                  aria-busy={claimingFarmId === row.farmId}
                >
                  {#if claimingFarmId === row.farmId}
                    <Spinner tone="light" />
                    {claimPhase === "signing" ? "Signing..." : "Claiming..."}
                  {:else}
                    Claim
                  {/if}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if claimError}
      <p class="farm-rewards-error">{claimError}</p>
    {/if}
    {#if claimSuccess}
      <p class="farm-rewards-success">{claimSuccess}</p>
    {/if}
  {/if}
</aside>

<style>
  .farm-rewards {
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
    gap: 0.75rem;
  }

  .farm-rewards-title {
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 700;
  }

  .farm-rewards-empty {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  .farm-rewards-error {
    margin: 0.25rem 0 0;
    color: #f87171;
    font-size: 0.875rem;
    line-height: 1.35;
  }

  .farm-rewards-success {
    margin: 0.25rem 0 0;
    color: #4ade80;
    font-size: 0.875rem;
    line-height: 1.35;
  }

  .farm-rewards-table-wrap {
    overflow-x: auto;
  }

  .farm-rewards-table {
    width: 100%;
    border-collapse: collapse;
  }

  .farm-rewards-table td {
    padding-bottom: 0.625rem;
    border-bottom: 1px solid var(--border-color);
  }

  .farm-rewards-table tbody tr:last-child td {
    border-bottom: none;
    padding-bottom: 0;
  }

  .token-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .token-symbol {
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 600;
    word-break: break-all;
  }

  .amount-cell {
    text-align: right;
  }

  .amount-cell {
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
    white-space: nowrap;
  }

  .action-cell {
    text-align: right;
  }

  .withdraw-btn {
    min-width: 6.5rem;
    height: 2.125rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: none;
    background: var(--accent-button-small);
    color: var(--text-on-accent);
    border-radius: 0.625rem;
    padding: 0 0.875rem;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .withdraw-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .withdraw-btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  @media (--small-mobile) {
    .farm-rewards {
      padding: 0.75rem;
    }

    .withdraw-btn {
      min-width: 5.5rem;
    }
  }
</style>
