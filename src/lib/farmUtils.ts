import type { TokenInfo, XykFarm, XykFarmReward } from "./types";
import { rawAmountToHumanReadable } from "./utils";

export const FARM_BLOCK_TIME_MS = 600;
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
const BLOCKS_PER_YEAR = MS_PER_YEAR / FARM_BLOCK_TIME_MS;

export function calculateFarmApyPercent(
  farms: XykFarm[] | undefined,
  liquidityUsd: number,
  selectTokenByAssetId: (assetId: string) => TokenInfo | null,
): number {
  if (!farms || farms.length === 0) return 0;
  if (liquidityUsd === 0) return 0;

  let annualRewardsUsd = 0;
  for (const farm of farms) {
    const rewardToken = selectTokenByAssetId(farm.asset_id);
    if (!rewardToken) continue;

    const priceUsd = parseFloat(rewardToken.price_usd ?? "0");
    if (priceUsd === 0) continue;

    const rewardPerBlock = parseFloat(
      rawAmountToHumanReadable(
        farm.reward_per_block,
        rewardToken.metadata.decimals,
      ),
    );
    if (rewardPerBlock === 0) continue;

    annualRewardsUsd += rewardPerBlock * BLOCKS_PER_YEAR * priceUsd;
  }

  const apyPercent = (annualRewardsUsd / liquidityUsd) * 100;
  return Math.max(0, apyPercent);
}

export function calculateLiveFarmRewardAmount(
  reward: XykFarmReward,
  decimals: number,
  asOfTimestampMs: number,
): number {
  const baseAmount = parseFloat(
    rawAmountToHumanReadable(reward.accrued_reward, decimals),
  );
  const rewardPerBlock =
    parseFloat(reward.your_reward_per_block) / Math.pow(10, decimals);
  let calculatedAtMs = Date.parse(reward.accrued_reward_calculated_at);
  if (calculatedAtMs !== calculatedAtMs) {
    calculatedAtMs = asOfTimestampMs;
  }
  const elapsedBlocks =
    Math.max(0, asOfTimestampMs - calculatedAtMs) / FARM_BLOCK_TIME_MS;

  return baseAmount + rewardPerBlock * elapsedBlocks;
}
