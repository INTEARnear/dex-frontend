import type { Token } from "./types";

// API base URLs
export const PRICES_API = "https://prices.intear.tech";
export const ROUTER_API = "https://router.intear.tech";
export const DEX_BACKEND_API = "https://dex-backend.intear.tech";

export function formatApy(apy: number): string {
  if (apy === 0) return "0%";
  if (apy < 0.001) return "<0.001%";
  return apy.toFixed(3).replace(/\.?0+$/, "") + "%";
}

/**
 * Format a number with up to 6 significant digits, capped at 8 decimal places.
 */
export function formatAmount(num: number): string {
  if (num === 0) return "0";
  if (num < 1e-6) return "<0.000001";

  const absNum = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  const addThousandsSeparators = (value: string): string => {
    const [intPart, decPart] = value.split(".");
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return decPart ? `${withCommas}.${decPart}` : withCommas;
  };

  if (absNum >= 1) {
    const wholePart = Math.floor(absNum);
    const wholeDigits = wholePart.toString().length;

    if (wholeDigits >= 6) {
      return sign + addThousandsSeparators(absNum.toFixed(0));
    }

    const decimalsForSigFigs = Math.max(0, 6 - wholeDigits);
    const decimals = Math.min(decimalsForSigFigs, 8);

    const formatted = absNum.toFixed(decimals).replace(/\.?0+$/, "");
    return sign + addThousandsSeparators(formatted);
  }

  let decimals = 0;
  let temp = absNum;

  while (temp < 1 && decimals < 30) {
    temp *= 10;
    decimals++;
  }

  const totalDecimals = Math.min(decimals + 6, 8);

  const formatted = absNum.toFixed(totalDecimals).replace(/\.?0+$/, "");
  return sign + addThousandsSeparators(formatted);
}

/**
 * Convert a human-readable token amount to raw (on-chain) representation.
 */
export function humanReadableToRawAmount(
  amountHumanReadable: string | number,
  decimals: number,
): string {
  let str = String(amountHumanReadable).trim();

  // Reject negative values
  if (str.startsWith("-")) return "0";

  // Strip leading plus if present
  if (str.startsWith("+")) str = str.slice(1);

  // Validate: only digits and at most one decimal point
  if (!/^\d*\.?\d*$/.test(str) || str === "" || str === ".") return "0";

  const dotIndex = str.indexOf(".");
  let intPart: string;
  let decPart: string;

  if (dotIndex === -1) {
    intPart = str;
    decPart = "";
  } else {
    intPart = str.slice(0, dotIndex);
    decPart = str.slice(dotIndex + 1);
  }

  // Handle empty integer part (e.g. ".5")
  if (!intPart) intPart = "0";

  // Truncate or pad fractional part to exactly `decimals` digits
  const paddedDec = decPart.slice(0, decimals).padEnd(decimals, "0");

  // Concatenate integer + padded fractional → raw amount
  const raw = (intPart + paddedDec).replace(/^0+/, "") || "0";

  return raw;
}

/**
 * Convert a raw (on-chain) token amount to human-readable representation.
 */
export function rawAmountToHumanReadable(
  amountRaw: string,
  decimals: number,
): string {
  if (!amountRaw || amountRaw === "0") return "0";
  const amountBigInt = BigInt(amountRaw);
  const divisor = BigInt(10) ** BigInt(decimals);
  const intPart = amountBigInt / divisor;
  const decPart = amountBigInt % divisor;
  const decStr = decPart.toString().padStart(decimals, "0");
  const trimmedDec = decStr.replace(/0+$/, "");
  if (!trimmedDec && intPart === BigInt(0)) return "0";
  if (!trimmedDec) return intPart.toString();
  return `${intPart}.${trimmedDec}`;
}

/**
 * Format a raw balance string with significant digits display.
 */
export function formatBalance(
  balanceRaw: string | null,
  decimals: number,
): string {
  if (!balanceRaw || balanceRaw === "0") return "0";
  const balanceHumanReadableNumber =
    parseFloat(balanceRaw) / Math.pow(10, decimals);
  if (balanceHumanReadableNumber === 0) return "0";
  return formatAmount(balanceHumanReadableNumber);
}

/**
 * Format a number compactly with up to 2 decimal places, stripping trailing zeros.
 */
export function formatCompact(num: number): string {
  return num.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Format a raw balance with compact suffixes (K, M, B, T, Q, Qi).
 * Returns null if balance is empty or zero.
 */
export function formatCompactBalance(
  balanceRaw: string | null | undefined,
  decimals: number,
): string | null {
  if (!balanceRaw) return null;

  const balance = parseFloat(balanceRaw) / Math.pow(10, decimals);
  if (balance === 0) return null;

  if (balance < 1000) return formatCompact(balance);
  if (balance < 1e6) return `${formatCompact(balance / 1e3)}K`;
  if (balance < 1e9) return `${formatCompact(balance / 1e6)}M`;
  if (balance < 1e12) return `${formatCompact(balance / 1e9)}B`;
  if (balance < 1e15) return `${formatCompact(balance / 1e12)}T`;
  if (balance < 1e18) return `${formatCompact(balance / 1e15)}Q`;
  return `${formatCompact(balance / 1e18)}Qi`;
}

/**
 * Format a USD value for display, with compact notation for large values.
 */
export function formatUsdValue(
  tokenAmountHumanReadable: string,
  tokenPriceUsd: string,
): string | null {
  if (!tokenAmountHumanReadable) return null;
  const num = parseFloat(tokenAmountHumanReadable);
  const price = parseFloat(tokenPriceUsd);
  if (isNaN(num) || isNaN(price) || num === 0) return null;
  const value = num * price;
  if (value < 0.01) return "<$0.01";
  if (value < 1000) return `$${value.toFixed(2)}`;
  if (value < 1000000) return `$${(value / 1000).toFixed(2)}K`;
  return `$${(value / 1000000).toFixed(2)}M`;
}

/**
 * Format liquidity USD for pool display (e.g. "$1.5K", "<$1").
 */
export function formatLiquidity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value < 1) return "<$1";
  if (value < 1000) return `$${formatCompact(value)}`;
  if (value < 1e6) return `$${formatCompact(value / 1e3)}K`;
  if (value < 1e9) return `$${formatCompact(value / 1e6)}M`;
  return `$${formatCompact(value / 1e9)}B`;
}

/**
 * Format fee percent for pool display, trimming trailing zeros.
 */
export function formatFeePercent(feePercent: number): string {
  let formatted = feePercent.toFixed(4);
  if (formatted.endsWith("00")) {
    formatted = formatted.slice(0, -2);
  } else if (formatted.endsWith("0")) {
    formatted = formatted.slice(0, -1);
  }
  return formatted;
}

/**
 * Format a date as relative time (e.g. "2d 4h ago", "3h 12m ago").
 */
export function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffDays > 0) return `${diffDays}d ${diffHr % 24}h ago`;
  if (diffHr > 0) return `${diffHr}h ${diffMin % 60}m ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  if (diffSec > 0) return `${diffSec}s ago`;
  return "now";
}

/**
 * Extract a data: URI icon from a token's metadata, or return null.
 */
export function getTokenIcon(token: Token | null): string | null {
  if (!token) return null;
  if (token.metadata?.icon?.startsWith("data:")) {
    return token.metadata.icon;
  }
  return null;
}
