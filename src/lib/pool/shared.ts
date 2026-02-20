import type { XykFeeConfiguration } from "../types";
import { DEX_BACKEND_API } from "../utils";
import { evaluateFeeConfigurationAtTimestamp } from "./feeUtils";

export const DEX_CONTRACT_ID = "dex.intear.near";
export const DEX_ID = "slimedragon.near/xyk";

export const STORAGE_DEPOSIT_NEAR = 10n ** 22n; // 0.01 NEAR
export const GAS_RESERVE_NEAR = 3n * 10n ** 22n; // 0.03 NEAR
export const AUTO_MIN_SLIPPAGE_PERCENT = 0.1;
export const AUTO_MAX_SLIPPAGE_PERCENT = 10;
export const AUTO_LIQUIDITY_SLIPPAGE_PERCENT = Math.pow(
  2,
  (Math.log2(AUTO_MIN_SLIPPAGE_PERCENT) +
    Math.log2(AUTO_MAX_SLIPPAGE_PERCENT)) /
    2,
);

const FEE_FRACTION_SCALE = 1_000_000;
const DAYS_PER_YEAR = 365;

export function getPoolFeeFractionDecimal(
  feeConfiguration: XykFeeConfiguration,
  timestampNanos = Date.now() * 1_000_000,
): number {
  const poolFeeFraction = evaluateFeeConfigurationAtTimestamp(
    feeConfiguration,
    timestampNanos,
  ).reduce((total, entry) => {
    if (entry.receiver !== "Pool") return total;
    return total + entry.feeFraction;
  }, 0);
  return poolFeeFraction / FEE_FRACTION_SCALE;
}

export function calculatePoolFeesApyPercent(
  volume24hUsd: number,
  poolFeeFractionDecimal: number,
  liquidityUsd: number,
): number {
  if (!Number.isFinite(volume24hUsd) || volume24hUsd <= 0) return 0;
  if (!Number.isFinite(poolFeeFractionDecimal) || poolFeeFractionDecimal <= 0) {
    return 0;
  }
  if (!Number.isFinite(liquidityUsd) || liquidityUsd <= 0) return 0;

  const annualizedFeesUsd =
    volume24hUsd * poolFeeFractionDecimal * DAYS_PER_YEAR;
  return (annualizedFeesUsd / liquidityUsd) * 100;
}

export function assetIdToTokenId(assetId: string): string | null {
  if (assetId === "near") return "near";
  if (assetId.startsWith("nep141:")) return assetId.slice("nep141:".length);
  return null;
}

export function isSupportedAsset(assetId: string): boolean {
  return assetId === "near" || assetId.startsWith("nep141:");
}

export function parsePoolId(raw: string | null): number | null {
  if (!raw) return null;
  const normalized = raw.startsWith("PLACH-") ? raw.slice(6) : raw;
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function getExecutionErrorMessage(status: unknown): string | null {
  if (!status || typeof status !== "object") return null;
  const maybeFailure = (status as { Failure?: unknown }).Failure;
  if (!maybeFailure || typeof maybeFailure !== "object") {
    return null;
  }
  const actionError = (maybeFailure as { ActionError?: unknown }).ActionError;
  if (!actionError || typeof actionError !== "object") {
    return JSON.stringify(maybeFailure);
  }
  const kind = (actionError as { kind?: unknown }).kind;
  if (!kind || typeof kind !== "object") {
    return JSON.stringify(maybeFailure);
  }
  const functionCallError = (kind as { FunctionCallError?: unknown })
    .FunctionCallError;
  if (!functionCallError || typeof functionCallError !== "object") {
    return JSON.stringify(maybeFailure);
  }
  const executionError = (functionCallError as { ExecutionError?: unknown })
    .ExecutionError;
  if (typeof executionError === "string") return executionError;
  return JSON.stringify(maybeFailure);
}

export async function checkAreAssetsRegistered(
  accountOrDexId: { Account: string } | { Dex: string },
  assetIds: string[],
): Promise<boolean> {
  const forParam = encodeURIComponent(JSON.stringify(accountOrDexId));
  const assetsParam = encodeURIComponent(assetIds.join(","));
  const response = await fetch(
    `${DEX_BACKEND_API}/are-assets-registered?for=${forParam}&assets=${assetsParam}`,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to check asset registration: HTTP ${response.status}`,
    );
  }
  return response.json();
}

export function assertOutcomesSucceeded(outcomes: unknown): void {
  if (!Array.isArray(outcomes)) return;
  for (const outcome of outcomes) {
    if (!outcome || typeof outcome !== "object") continue;
    const receiptsOutcome = (outcome as { receipts_outcome?: unknown })
      .receipts_outcome;
    if (!Array.isArray(receiptsOutcome)) continue;
    for (const receiptOutcome of receiptsOutcome) {
      if (!receiptOutcome || typeof receiptOutcome !== "object") continue;
      const status = (receiptOutcome as { outcome?: { status?: unknown } })
        .outcome?.status;
      const message = getExecutionErrorMessage(status);
      if (message) {
        if (message.includes("Slippage error")) {
          throw new Error(
            "Slippage error: pool ratio changed while confirming. Try again.",
          );
        }
        throw new Error(message);
      }
    }
  }
}
