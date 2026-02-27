<script lang="ts">
  import { onMount } from "svelte";
  import { Globe } from "lucide-svelte";
  import { siTelegram, siX } from "simple-icons";
  import LaunchRecentTradesGrid from "./LaunchRecentTradesGrid.svelte";
  import PoolFeeBreakdown from "../../../lib/pool/PoolFeeBreakdown.svelte";
  import { assetIdToTokenId } from "../../../lib/pool/shared";
  import SwapForm from "../../../lib/SwapForm.svelte";
  import type { TokenInfo, XykFeeConfiguration, XykPool } from "../../../lib/types";
  import { DEX_BACKEND_API, getTokenIcon } from "../../../lib/utils";
  import type { LaunchApiTokenData } from "../types";

  interface Props {
    token: TokenInfo;
    launchData: LaunchApiTokenData;
    marketCap: string;
  }

  let { token, launchData, marketCap }: Props = $props();

  let chartTheme = $state<"light" | "dark">("dark");
  let activeLaunchPoolRequestId = 0;
  let isLaunchPoolFeeLoading = $state(false);
  let oldestLaunchPoolFeeConfiguration = $state<XykFeeConfiguration | null>(null);

  interface OldestLaunchPoolFeeInfo {
    poolId: number;
    configuration: XykFeeConfiguration;
  }

  const launchFeeByTokenId = new Map<string, OldestLaunchPoolFeeInfo | null>();

  function resolveTheme(): "light" | "dark" {
    return document.documentElement.dataset.theme === "light"
      ? "light"
      : "dark";
  }

  const launchTimestamp = $derived.by(() => {
    const nanos = launchData.launched_at_ns;
    if (!Number.isFinite(nanos) || nanos <= 0) return "Unknown";
    const asMs = Math.floor(nanos / 1_000_000);
    return new Date(asMs).toLocaleString();
  });

  const chartSrc = $derived(
    `https://chart.intear.tech/?token=${token.account_id}&search=false&theme=${chartTheme}`,
  );
  const tokenIconSrc = $derived(getTokenIcon(token));

  function findOldestLaunchPoolFee(
    pools: XykPool[],
    tokenAccountId: string,
  ): OldestLaunchPoolFeeInfo | null {
    let oldestLaunchPool: OldestLaunchPoolFeeInfo | null = null;
    for (const pool of pools) {
      if (!("Launch" in pool.pool)) continue;
      const launchedTokenId = assetIdToTokenId(
        pool.pool.Launch.launched_asset.asset_id,
      );
      if (launchedTokenId !== tokenAccountId) continue;
      if (!oldestLaunchPool || pool.id < oldestLaunchPool.poolId) {
        oldestLaunchPool = {
          poolId: pool.id,
          configuration: pool.pool.Launch.fee_configuration,
        };
      }
    }
    return oldestLaunchPool;
  }

  async function fetchOldestLaunchPoolFee(
    tokenAccountId: string,
  ): Promise<void> {
    const cached = launchFeeByTokenId.get(tokenAccountId);
    if (cached !== undefined) {
      oldestLaunchPoolFeeConfiguration = cached?.configuration ?? null;
      isLaunchPoolFeeLoading = false;
      return;
    }

    const requestId = ++activeLaunchPoolRequestId;
    isLaunchPoolFeeLoading = true;
    oldestLaunchPoolFeeConfiguration = null;

    try {
      const response = await fetch(`${DEX_BACKEND_API}/pools/all`);
      if (!response.ok) {
        throw new Error(`Failed to fetch pools: HTTP ${response.status}`);
      }
      const pools = (await response.json()) as XykPool[];
      if (requestId !== activeLaunchPoolRequestId) return;

      const oldestLaunchPool = findOldestLaunchPoolFee(pools, tokenAccountId);
      launchFeeByTokenId.set(tokenAccountId, oldestLaunchPool);
      oldestLaunchPoolFeeConfiguration = oldestLaunchPool?.configuration ?? null;
    } catch (error) {
      if (requestId !== activeLaunchPoolRequestId) return;
      console.error("Failed to fetch launch pool fee configuration:", error);
      launchFeeByTokenId.set(tokenAccountId, null);
      oldestLaunchPoolFeeConfiguration = null;
    } finally {
      if (requestId === activeLaunchPoolRequestId) {
        isLaunchPoolFeeLoading = false;
      }
    }
  }

  function hasAnySocialLinks(data: LaunchApiTokenData): boolean {
    return Boolean(data.x || data.telegram || data.website);
  }

  let lastLoadedLaunchPoolFeeTokenId = $state<string | null>(null);
  $effect(() => {
    const tokenAccountId = token.account_id;
    if (!tokenAccountId) return;
    if (lastLoadedLaunchPoolFeeTokenId === tokenAccountId) return;
    lastLoadedLaunchPoolFeeTokenId = tokenAccountId;
    void fetchOldestLaunchPoolFee(tokenAccountId);
  });

  onMount(() => {
    chartTheme = resolveTheme();
    const observer = new MutationObserver(() => {
      chartTheme = resolveTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  });
</script>

<div class="detail-view">
  <div class="detail-layout">
    <section class="chart-panel">
      <iframe
        src={chartSrc}
        title={`${token.metadata.symbol} launch chart`}
        class="chart-frame"
        loading="lazy"
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    </section>

    <section class="content-panel">
      <article class="token-meta-card">
        <div class="token-main-layout">
          <div class="token-main-content">
            <div class="token-header">
              <div class="token-icon-shell">
                {#if tokenIconSrc}
                  <img
                    src={tokenIconSrc}
                    alt={`${token.metadata.symbol} token`}
                    class="token-icon-image"
                  />
                {:else}
                  <div class="token-icon-placeholder">
                    {token.metadata.symbol.charAt(0) || "?"}
                  </div>
                {/if}
              </div>
              <div class="token-title-block">
                <h2>{token.metadata.name}</h2>
                <p class="token-symbol">{token.metadata.symbol}</p>
                <p class="token-mcap">mcap {marketCap}</p>
              </div>
            </div>
            <p class="token-description">{launchData.description}</p>
          </div>

          <aside class="token-fee-column">
            {#if isLaunchPoolFeeLoading}
              <p class="token-fee-loading">Loading fee...</p>
            {:else}
              <PoolFeeBreakdown configuration={oldestLaunchPoolFeeConfiguration} label="Main Pool Fee" />
            {/if}
          </aside>
        </div>

        <div class="token-footer">
          {#if hasAnySocialLinks(launchData)}
            <div class="token-links">
              {#if launchData.x}
                <a
                  href={launchData.x}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="token-link-btn"
                  aria-label="Token X"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    role="img"
                  >
                    <path d={siX.path} />
                  </svg>
                </a>
              {/if}
              {#if launchData.telegram}
                <a
                  href={launchData.telegram}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="token-link-btn"
                  aria-label="Token Telegram"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    role="img"
                  >
                    <path d={siTelegram.path} />
                  </svg>
                </a>
              {/if}
              {#if launchData.website}
                <a
                  href={launchData.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="token-link-btn"
                  aria-label="Token Website"
                >
                  <Globe size={16} />
                </a>
              {/if}
            </div>
          {/if}

          <p class="launch-meta">
            Launched by
            <a
              href={`https://nearblocks.io/address/${launchData.launched_by}`}
              target="_blank"
              rel="noopener noreferrer"
              title={launchData.launched_by}
            >
              {launchData.launched_by}
            </a>
            at
            <span>{launchTimestamp}</span>
          </p>
        </div>
      </article>

      <article class="swap-panel">
        {#key token.account_id}
          <SwapForm
            compact
            hideSubtitle
            lockedPair={{ baseTokenId: "near", quoteTokenId: token.account_id }}
            actionLabels="buySell"
          />
        {/key}
      </article>
    </section>
  </div>

  <LaunchRecentTradesGrid tokenAccountId={token.account_id} />
</div>

<style>
  .detail-view {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .detail-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }

  .chart-panel {
    overflow: hidden;
    height: 100%;
  }

  .chart-frame {
    width: 100%;
    height: 100%;
    border: 1px solid var(--border-color);
    border-radius: 0.375rem 1rem 1rem 1rem;
    display: block;
  }

  .content-panel {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    min-width: 0;
  }

  .token-meta-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .token-main-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(240px, 280px);
    gap: 0.95rem;
    align-items: start;
    min-width: 0;
  }

  .token-main-content {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .token-fee-column {
    min-width: 0;
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    background: var(--bg-secondary);
    padding: 0.7rem;
  }

  .token-fee-loading {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.875rem;
    font-family: "JetBrains Mono", monospace;
  }

  .token-header {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-width: 0;
  }

  .token-icon-shell {
    width: 88px;
    height: 88px;
    border-radius: 0.9rem;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
  }

  .token-icon-image,
  .token-icon-placeholder {
    width: 100%;
    height: 100%;
    display: block;
  }

  .token-icon-image {
    object-fit: cover;
    object-position: center;
  }

  .token-icon-placeholder {
    background: linear-gradient(
      135deg,
      var(--accent-gradient-start),
      var(--accent-gradient-end)
    );
    color: var(--text-on-accent);
    font-size: 2.1rem;
    font-weight: 700;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .token-title-block {
    min-width: 0;
    flex: 1;
  }

  .token-title-block h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 1.35rem;
    line-height: 1.15;
    word-break: break-word;
  }

  .token-symbol {
    margin: 0.22rem 0 0;
    color: var(--text-muted);
    font-size: 0.88rem;
    font-family: "JetBrains Mono", monospace;
    text-transform: uppercase;
    word-break: break-word;
  }

  .token-mcap {
    margin: 0.24rem 0 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
    font-family: "JetBrains Mono", monospace;
    text-transform: uppercase;
    word-break: break-word;
  }

  .token-description {
    margin: 0;
    color: var(--text-secondary);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .token-links {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .token-link-btn {
    text-decoration: none;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    width: 1.9rem;
    height: 1.9rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      border-color 0.2s ease,
      color 0.2s ease,
      background 0.2s ease;
  }

  .token-link-btn:hover {
    border-color: var(--accent-primary);
    color: var(--text-primary);
    background: var(--bg-input);
  }

  .token-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-width: 0;
  }

  .launch-meta {
    margin: 0;
    margin-left: auto;
    color: var(--text-muted);
    font-size: 0.78rem;
    font-family: "JetBrains Mono", monospace;
    text-align: right;
  }

  .launch-meta a {
    display: inline-block;
    max-width: 15rem;
    color: var(--text-primary);
    text-decoration: none;
    vertical-align: bottom;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .launch-meta a:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .swap-panel {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  @media (max-width: 960px) {
    .detail-layout {
      grid-template-columns: 1fr;
    }

    .content-panel {
      order: 1;
    }

    .chart-panel {
      order: 2;
    }

    .chart-panel {
      min-height: 460px;
    }

    .chart-frame {
      min-height: 460px;
    }
  }

  @media(min-width: 480px) and (max-width: 1200px) {
    .token-main-layout {
      grid-template-columns: minmax(0, 1fr) minmax(160px, 200px);
    }
  }

  @media (--mobile) {
    .content-panel {
      order: 1;
    }

    .chart-panel {
      order: 2;
      min-height: 380px;
      width: 100%;
    }

    .chart-frame {
      min-height: 380px;
      width: 100%;
    }

    .token-meta-card {
      padding: 0.8rem;
      gap: 0.7rem;
    }

    .token-header {
      align-items: flex-start;
    }

    .token-icon-shell {
      width: 72px;
      height: 72px;
    }

    .token-main-layout {
      grid-template-columns: 1fr;
      gap: 0.7rem;
    }

    .token-fee-column {
      padding: 0.65rem;
    }

    .token-footer {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.55rem;
    }

    .launch-meta {
      margin-left: 0;
      font-size: 0.74rem;
      max-width: 100%;
      text-align: left;
    }

    .launch-meta a {
      max-width: 100%;
    }
  }
</style>
