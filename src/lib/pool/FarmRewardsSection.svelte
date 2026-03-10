<script lang="ts">
  import { untrack } from "svelte";
  import TokenIcon from "../TokenIcon.svelte";
  import { FARM_BLOCK_TIME_MS } from "../farmUtils";
  import { tokenHubStore } from "../tokenHubStore";
  import type { XykFarmReward } from "../types";
  import { rawAmountToHumanReadable } from "../utils";
  import { assetIdToTokenId } from "./shared";

  interface Props {
    rewards: XykFarmReward[];
  }

  interface RewardState {
    farmId: number;
    assetId: string;
    accruedAmount: number;
    rewardPerBlock: number;
  }

  const REWARD_SYNC_THRESHOLD_USD = 0.01;

  let { rewards }: Props = $props();
  let rewardStates = $state<RewardState[]>([]);
  let nowMs = $state(Date.now());
  let rewardsSnapshotTimestampMs = $state(Date.now());
  let showBetaModal = $state(false);

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
        token,
        symbol: token?.metadata.symbol ?? reward.assetId,
        amountLabel: amount.toFixed(4),
      };
    });
  });

  function handleWithdrawClick() {
    showBetaModal = true;
  }

  function closeBetaModal() {
    showBetaModal = false;
  }

  function handleModalBackdropKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeBetaModal();
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
                  onclick={handleWithdrawClick}
                >
                  Withdraw
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</aside>

{#if showBetaModal}
  <div
    class="modal-backdrop"
    role="presentation"
    tabindex="-1"
    onclick={closeBetaModal}
    onkeydown={handleModalBackdropKeyDown}
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="farm-rewards-beta-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <div class="modal-header">
        <h2 id="farm-rewards-beta-title">Feature still in beta</h2>
      </div>
      <div class="modal-body">
        <p class="beta-modal-message">
          Withdrawal will become available in 1-2 days
        </p>
      </div>
      <div class="modal-footer">
        <button type="button" class="submit-btn" onclick={closeBetaModal}>
          Okay
        </button>
      </div>
    </div>
  </div>
{/if}

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

  .withdraw-btn:hover {
    background: var(--accent-hover);
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

  .beta-modal-message {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    padding: 1rem 1.5rem 1.25rem;
    border-top: 1px solid var(--border-color);
  }

  .submit-btn {
    flex: 1;
    padding: 0.875rem 1.5rem;
    border-radius: 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    background: var(--accent-button-small);
    border: none;
    color: var(--text-on-accent);
  }

  .submit-btn:hover {
    background: var(--accent-hover);
  }

  @media (--small-mobile) {
    .farm-rewards {
      padding: 0.75rem;
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

    .withdraw-btn {
      min-width: 5.5rem;
    }
  }
</style>
