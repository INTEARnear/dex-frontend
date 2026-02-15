<script lang="ts">
  import type { Token } from "../types";
  import type { NormalizedPool } from "./shared";
  import { formatAmount, rawAmountToHumanReadable } from "../utils";

  interface Props {
    poolData: NormalizedPool | null;
    token0: Token | null;
    token1: Token | null;
    userSharesRaw: string | null;
  }

  let { poolData, token0, token1, userSharesRaw }: Props = $props();

  const breakdown = $derived.by(() => {
    if (
      !poolData ||
      !token0 ||
      !token1 ||
      !userSharesRaw ||
      !poolData.totalSharesRaw
    ) {
      return null;
    }

    const userShares = BigInt(userSharesRaw);
    const totalPoolShares = BigInt(poolData.totalSharesRaw);
    if (userShares <= 0n || totalPoolShares <= 0n) return null;

    const poolBalance0 = BigInt(poolData.assets[0].balance);
    const poolBalance1 = BigInt(poolData.assets[1].balance);
    const amount0Raw = (userShares * poolBalance0) / totalPoolShares;
    const amount1Raw = (userShares * poolBalance1) / totalPoolShares;

    const amount0Human = rawAmountToHumanReadable(
      amount0Raw.toString(),
      token0.metadata.decimals,
    );
    const amount1Human = rawAmountToHumanReadable(
      amount1Raw.toString(),
      token1.metadata.decimals,
    );

    const amount0Num = parseFloat(amount0Human);
    const amount1Num = parseFloat(amount1Human);
    const price0 = parseFloat(token0.price_usd || "0");
    const price1 = parseFloat(token1.price_usd || "0");
    const usd0 = amount0Num * price0;
    const usd1 = amount1Num * price1;
    const totalUsd = usd0 + usd1;

    return {
      amount0: Number.isFinite(amount0Num) ? amount0Num : 0,
      amount1: Number.isFinite(amount1Num) ? amount1Num : 0,
      usd0: Number.isFinite(usd0) && usd0 > 0 ? usd0 : 0,
      usd1: Number.isFinite(usd1) && usd1 > 0 ? usd1 : 0,
      totalUsd: Number.isFinite(totalUsd) && totalUsd > 0 ? totalUsd : 0,
    };
  });
</script>

{#if breakdown}
  <aside class="liquidity-info">
    <div class="your-liquidity-title">Your Liquidity</div>
    <div class="your-liquidity-row">
      <span class="your-liquidity-label">{token0?.metadata.symbol ?? "?"}</span>
      <div class="your-liquidity-values">
        <span class="your-liquidity-amount">
          {formatAmount(breakdown.amount0)}
        </span>
        <span class="your-liquidity-usd">
          {breakdown.usd0 > 0 ? `$${formatAmount(breakdown.usd0)}` : "—"}
        </span>
      </div>
    </div>
    <div class="your-liquidity-row">
      <span class="your-liquidity-label">{token1?.metadata.symbol ?? "?"}</span>
      <div class="your-liquidity-values">
        <span class="your-liquidity-amount">
          {formatAmount(breakdown.amount1)}
        </span>
        <span class="your-liquidity-usd">
          {breakdown.usd1 > 0 ? `$${formatAmount(breakdown.usd1)}` : "—"}
        </span>
      </div>
    </div>
    <div class="your-liquidity-total">
      <span class="your-liquidity-total-label">Total</span>
      <span class="your-liquidity-total-value">
        {breakdown.totalUsd > 0 ? `$${formatAmount(breakdown.totalUsd)}` : "—"}
      </span>
    </div>
  </aside>
{/if}

<style>
  .liquidity-info {
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

  .your-liquidity-title {
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 700;
  }

  .your-liquidity-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
  }

  .your-liquidity-label {
    color: var(--text-secondary);
    font-size: 0.8125rem;
    min-width: 0;
  }

  .your-liquidity-values {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
    margin-left: auto;
  }

  .your-liquidity-amount {
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
  }

  .your-liquidity-usd {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: "JetBrains Mono", monospace;
  }

  .your-liquidity-total {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-color);
    margin-top: 0.125rem;
  }

  .your-liquidity-total-label {
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  .your-liquidity-total-value {
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
  }

  @media (--mobile) {
    .liquidity-info {
      gap: 0.375rem;
    }

    .your-liquidity-title {
      font-size: 0.8125rem;
    }

    .your-liquidity-label,
    .your-liquidity-total-label {
      font-size: 0.75rem;
    }

    .your-liquidity-amount,
    .your-liquidity-total-value {
      font-size: 0.8125rem;
    }

    .your-liquidity-usd {
      font-size: 0.6875rem;
    }
  }

  @media (--small-mobile) {
    .liquidity-info {
      padding: 0.75rem;
      gap: 0.25rem;
    }

    .your-liquidity-title {
      font-size: 0.75rem;
    }

    .your-liquidity-label,
    .your-liquidity-total-label {
      font-size: 0.6875rem;
    }

    .your-liquidity-amount,
    .your-liquidity-total-value {
      font-size: 0.75rem;
    }

    .your-liquidity-usd {
      font-size: 0.625rem;
    }
  }
</style>
