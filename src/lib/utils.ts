import type { Token, UserTokenBalance, UserTokensResponse } from "./types";

// API base URLs
export const PRICES_API = "https://prices.intear.tech";
export const ROUTER_API = "https://router.intear.tech";

/**
 * Format a number with up to 6 significant digits, capped at 8 decimal places.
 */
export function formatTokenAmount(num: number): string {
  if (num === 0) return "0";
  if (num < 1e-6) return "<0.000001";

  const absNum = Math.abs(num);

  if (absNum >= 1) {
    const wholePart = Math.floor(absNum);
    const wholeDigits = wholePart.toString().length;

    if (wholeDigits >= 6) {
      return num.toFixed(0);
    }

    const decimalsForSigFigs = Math.max(0, 6 - wholeDigits);
    const decimals = Math.min(decimalsForSigFigs, 8);

    return num.toFixed(decimals).replace(/\.?0+$/, "");
  }

  let decimals = 0;
  let temp = absNum;

  while (temp < 1 && decimals < 30) {
    temp *= 10;
    decimals++;
  }

  const totalDecimals = Math.min(decimals + 6, 8);

  return num.toFixed(totalDecimals).replace(/\.?0+$/, "");
}

/**
 * Convert a human-readable token amount to raw (on-chain) representation.
 */
export function humanReadableToRawAmount(
  amountHumanReadable: string | number,
  decimals: number,
): string {
  const num = parseFloat(String(amountHumanReadable));
  if (isNaN(num) || num <= 0) return "0";

  const fixedStr = num.toFixed(decimals);
  const [intPart, decPart = ""] = fixedStr.split(".");

  const cleanInt = intPart.replace(/^0+/, "") || "0";
  const cleanDec = decPart.slice(0, decimals).padEnd(decimals, "0");

  const multiplier = BigInt(10) ** BigInt(decimals);
  return (BigInt(cleanInt) * multiplier + BigInt(cleanDec)).toString();
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
  return formatTokenAmount(balanceHumanReadableNumber);
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
 * Fetch user token balances from the API.
 * Returns a record mapping token account_id to raw balance string.
 */
export async function fetchUserBalances(
  accountId: string,
): Promise<Record<string, UserTokenBalance>> {
  const response = await fetch(
    `${PRICES_API}/get-user-tokens?account_id=${accountId}&native=true`,
  );
  if (response.ok) {
    const data = await response.json();
    const balances: Record<string, UserTokenBalance> = {};
    for (const item of data) {
      balances[item.token.account_id] = item;
    }
    return balances;
  }
  return {};
}

/**
 * Fetch current token prices from the API.
 * Returns a record mapping token account_id to price USD string.
 */
export async function fetchPrices(): Promise<Record<string, string>> {
  const response = await fetch(`${PRICES_API}/prices`);
  if (response.ok) {
    return await response.json();
  }
  return {};
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
