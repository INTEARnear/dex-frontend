<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { Check, Copy, Globe, LoaderCircle, Pencil } from "lucide-svelte";
  import { siTelegram, siTwitch, siX } from "simple-icons";
  import RecentTradesGrid from "$lib/RecentTradesGrid.svelte";
  import TokenChart from "$lib/TokenChart.svelte";
  import TwitchLiveEmbed from "./TwitchLiveEmbed.svelte";
  import PoolFeeBreakdown from "$lib/pool/PoolFeeBreakdown.svelte";
  import { assertOutcomesSucceeded, assetIdToTokenId } from "$lib/pool/shared";
  import SwapForm from "$lib/SwapForm.svelte";
  import ErrorModal from "$lib/ErrorModal.svelte";
  import type { TokenInfo, XykFeeConfiguration, XykPool } from "$lib/types";
  import { DEX_BACKEND_API, getTokenIcon, viewFunction } from "$lib/utils";
  import { walletStore } from "$lib/walletStore";
  import { isLaunchV2Token } from "./launchContracts";
  import type { LaunchInfo, LaunchTradeChartMarker } from "./types";

  interface Props {
    token: TokenInfo;
    /** Null while it's loading from the launch contract, or if the contract has none */
    launchData: LaunchInfo | null;
    marketCap: string;
    onEditClick: () => void;
  }

  let { token, launchData, marketCap, onEditClick }: Props = $props();

  const REWARDS_REFRESH_INTERVAL_MS = 10_000;
  const MIN_CLAIMABLE_REWARDS_YOCTO = 10n ** 22n; // 0.01 NEAR
  const NEAR_YOCTO_PER_MILLI = 10n ** 21n;

  const canEdit = $derived(
    $walletStore.isConnected &&
      launchData !== null &&
      $walletStore.accountId === launchData.launched_by,
  );

  let chartTheme = $state<"light" | "dark">("dark");
  let activeLaunchPoolRequestId = 0;
  let isLaunchPoolFeeLoading = $state(false);
  let oldestLaunchPoolFeeConfiguration = $state<XykFeeConfiguration | null>(null);
  let contentPanelElement = $state<HTMLElement | null>(null);
  let snappedChartPanelHeight = $state<number | null>(null);
  let copiedContractAddress = $state(false);
  let chartTraderFilter = $state<string | null>(null);
  let chartTraderTrades = $state<LaunchTradeChartMarker[]>([]);
  let copyResetTimer: number | null = null;

  interface OldestLaunchPoolFeeInfo {
    poolId: number;
    configuration: XykFeeConfiguration;
  }

  const launchFeeByTokenId = new Map<string, OldestLaunchPoolFeeInfo | null>();

  // Deriveds only notify on change, so price refreshes of `token` don't restart polling
  const tokenAccountId = $derived(token.account_id);
  const hasHolderRewards = $derived(isLaunchV2Token(tokenAccountId));
  const connectedAccountId = $derived($walletStore.accountId);
  let claimableRewardsYocto = $state<bigint | null>(null);
  let isClaimingRewards = $state(false);
  let claimRewardsError = $state<string | null>(null);
  let activeRewardsRequestId = 0;

  const canClaimRewards = $derived(
    claimableRewardsYocto !== null &&
      claimableRewardsYocto >= MIN_CLAIMABLE_REWARDS_YOCTO,
  );

  const claimableRewardsLabel = $derived.by(() => {
    if (claimableRewardsYocto === null) return "0";
    // Round down to 0.001 NEAR so the label never promises more than is claimable
    const milliNear = claimableRewardsYocto / NEAR_YOCTO_PER_MILLI;
    const whole = milliNear / 1000n;
    const fraction = (milliNear % 1000n).toString().padStart(3, "0");
    return `${whole}.${fraction}`;
  });

  async function fetchClaimableRewards(
    rewardsTokenId: string,
    accountId: string,
  ): Promise<void> {
    const requestId = ++activeRewardsRequestId;
    try {
      const rewards = await viewFunction<string>(rewardsTokenId, "get_rewards", {
        account_id: accountId,
      });
      if (requestId !== activeRewardsRequestId) return;
      claimableRewardsYocto = BigInt(rewards);
    } catch (error) {
      if (requestId !== activeRewardsRequestId) return;
      console.error("Failed to fetch claimable rewards:", error);
    }
  }

  $effect(() => {
    const rewardsTokenId = tokenAccountId;
    const accountId = connectedAccountId;
    claimableRewardsYocto = null;
    activeRewardsRequestId += 1;
    if (!hasHolderRewards || !accountId) return;

    void fetchClaimableRewards(rewardsTokenId, accountId);
    const timer = setInterval(() => {
      void fetchClaimableRewards(rewardsTokenId, accountId);
    }, REWARDS_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  });

  async function claimRewards(): Promise<void> {
    const wallet = $walletStore.wallet;
    const accountId = connectedAccountId;
    if (!wallet || !accountId || isClaimingRewards) return;

    const rewardsTokenId = tokenAccountId;
    isClaimingRewards = true;
    try {
      const outcomes = await wallet.signAndSendTransactions({
        transactions: [
          {
            receiverId: rewardsTokenId,
            actions: [
              {
                type: "FunctionCall" as const,
                params: {
                  methodName: "claim_rewards",
                  args: {},
                  gas: "30" + "0".repeat(12), // 30 TGas
                  deposit: "0",
                },
              },
            ],
          },
        ],
      });
      assertOutcomesSucceeded(outcomes);
    } catch (error) {
      claimRewardsError =
        error instanceof Error ? error.message : "Failed to claim rewards";
    } finally {
      isClaimingRewards = false;
      if (
        tokenAccountId === rewardsTokenId &&
        connectedAccountId === accountId
      ) {
        void fetchClaimableRewards(rewardsTokenId, accountId);
      }
    }
  }

  function resolveTheme(): "light" | "dark" {
    return document.documentElement.dataset.theme === "light"
      ? "light"
      : "dark";
  }

  function syncChartPanelHeight(desktopMediaQuery: MediaQueryList): void {
    if (!desktopMediaQuery.matches || !contentPanelElement) {
      snappedChartPanelHeight = null;
      return;
    }

    const contentHeight = Math.ceil(contentPanelElement.getBoundingClientRect().height);
    snappedChartPanelHeight = contentHeight > 0 ? contentHeight : null;
  }

  const launchTimestamp = $derived.by(() => {
    if (!launchData) return null;
    const nanos = launchData.launched_at_ns;
    const asMs = Math.floor(nanos / 1_000_000);
    return new Date(asMs).toLocaleString();
  });

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

  function hasAnySocialLinks(data: LaunchInfo): boolean {
    return Boolean(data.x || data.telegram || data.twitch || data.website);
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
    const themeObserver = new MutationObserver(() => {
      chartTheme = resolveTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const desktopMediaQuery = window.matchMedia("(min-width: 961px)");
    const resizeObserver = new ResizeObserver(() => {
      syncChartPanelHeight(desktopMediaQuery);
    });
    if (contentPanelElement) {
      resizeObserver.observe(contentPanelElement);
    }

    const onDesktopMediaQueryChange = () => {
      syncChartPanelHeight(desktopMediaQuery);
    };

    desktopMediaQuery.addEventListener("change", onDesktopMediaQueryChange);

    syncChartPanelHeight(desktopMediaQuery);

    return () => {
      themeObserver.disconnect();
      resizeObserver.disconnect();
      desktopMediaQuery.removeEventListener("change", onDesktopMediaQueryChange);
    };
  });

  onDestroy(() => {
    if (copyResetTimer !== null) {
      clearTimeout(copyResetTimer);
      copyResetTimer = null;
    }
  });

  async function copyContractAddress(): Promise<void> {
    await navigator.clipboard.writeText(token.account_id);
    copiedContractAddress = true;
    if (copyResetTimer !== null) {
      clearTimeout(copyResetTimer);
    }
    copyResetTimer = setTimeout(() => {
      copiedContractAddress = false;
      copyResetTimer = null;
    }, 2_000);
  }
</script>

<div class="detail-view">
  <TwitchLiveEmbed
    twitchUrl={launchData?.twitch ?? null}
    tokenSymbol={token.metadata.symbol}
  />

  <div class="detail-layout">
    <section
      class="chart-panel"
      style={snappedChartPanelHeight === null
        ? undefined
        : `--chart-panel-height:${snappedChartPanelHeight}px;`}
    >
      <TokenChart
        tokenAccountId={token.account_id}
        tokenName={token.metadata.name}
        tokenSymbol={token.metadata.symbol}
        tokenDecimals={token.metadata.decimals}
        tokenIcon={tokenIconSrc}
        tokenPriceUsd={token.price_usd}
        traderFilter={chartTraderFilter}
        traderTrades={chartTraderTrades}
        theme={chartTheme}
        title={`${token.metadata.symbol} launch chart`}
      />
    </section>

    <section class="content-panel" bind:this={contentPanelElement}>
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
            {#if launchData?.description}
              <p class="token-description">{launchData.description}</p>
            {/if}
          </div>

          <div class="token-side-column">
            <aside class="token-fee-column">
              {#if isLaunchPoolFeeLoading}
                <p class="token-fee-loading">Loading fee...</p>
              {:else}
                <PoolFeeBreakdown
                  configuration={oldestLaunchPoolFeeConfiguration}
                  label="Main Pool Fee"
                  holdersAccountId={hasHolderRewards ? token.account_id : null}
                />
              {/if}
            </aside>
            {#if hasHolderRewards && canClaimRewards}
              <button
                type="button"
                class="claim-rewards-btn"
                onclick={claimRewards}
                disabled={isClaimingRewards}
                title="Claim your share of trading fees paid to holders"
                transition:fade={{ duration: 200 }}
              >
                {#if isClaimingRewards}
                  <LoaderCircle size={14} class="spinning" />
                {/if}
                Claim {claimableRewardsLabel} NEAR
              </button>
            {/if}
          </div>
        </div>
        <div class="token-contract-row">
          <span class="token-contract-label">CA</span>
          <code class="token-contract-value">{token.account_id}</code>
          <button
            type="button"
            class="token-contract-copy-btn"
            class:copied={copiedContractAddress}
            onclick={copyContractAddress}
            aria-label={`Copy contract address ${token.account_id}`}
            title={copiedContractAddress ? "Copied" : "Copy contract address"}
          >
            {#if copiedContractAddress}
              <Check size={14} strokeWidth={2.2} />
            {:else}
              <Copy size={14} strokeWidth={2} />
            {/if}
          </button>
        </div>

        <div class="token-footer">
          {#if canEdit}
            <button
              type="button"
              class="edit-btn"
              onclick={onEditClick}
              aria-label="Edit token"
            >
              <Pencil size={14} />
              Edit
            </button>
          {/if}
          {#if launchData && hasAnySocialLinks(launchData)}
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
              {#if launchData.twitch}
                <a
                  href={launchData.twitch}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="token-link-btn"
                  aria-label="Token Twitch"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    role="img"
                  >
                    <path d={siTwitch.path} />
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

          {#if launchData}
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
          {/if}
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

  <RecentTradesGrid
    tokenAccountId={token.account_id}
    onTraderFilterChange={(trader) => (chartTraderFilter = trader)}
    onTraderTradesChange={(trades) => (chartTraderTrades = trades)}
  />
</div>

<ErrorModal
  isOpen={claimRewardsError !== null}
  onClose={() => (claimRewardsError = null)}
  title="Claim Failed"
  message={claimRewardsError ?? ""}
  isTransaction={true}
/>

<style>
  .detail-view {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .detail-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 540px);
    gap: 1rem;
    align-items: start;
  }

  .chart-panel {
    overflow: hidden;
    height: var(--chart-panel-height, 100%);
  }


  .content-panel {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    min-width: 0;
  }

  .token-meta-card {
    background: var(--bg-card);
    border: 1.2px solid var(--border-color);
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

  .token-side-column {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .token-fee-column {
    min-width: 0;
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    background: var(--bg-secondary);
    padding: 0.7rem;
  }

  .claim-rewards-btn {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
    border: none;
    border-radius: 0.75rem;
    background: var(--accent-button-small);
    box-shadow: 0 0 18px var(--accent-glow);
    color: var(--text-on-accent);
    font-size: 0.875rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
    cursor: pointer;
    transition:
      background 0.2s ease,
      box-shadow 0.2s ease;
  }

  .claim-rewards-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 0 24px var(--accent-glow);
  }

  .claim-rewards-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .claim-rewards-btn :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
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

  .token-contract-row {
    margin-top: 0.3rem;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    width: 100%;
  }

  .token-contract-label {
    color: var(--text-muted);
    font-size: 0.76rem;
    font-family: "JetBrains Mono", monospace;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .token-contract-value {
    margin: 0;
    min-width: 0;
    flex: 1;
    color: var(--text-secondary);
    font-size: 0.78rem;
    font-family: "JetBrains Mono", monospace;
    white-space: normal;
    word-break: break-all;
  }

  .token-contract-copy-btn {
    border: none;
    border-radius: 0.4rem;
    width: 1.45rem;
    height: 1.45rem;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: pointer;
    transition: color 0.2s ease;
  }

  .token-contract-copy-btn:hover {
    color: var(--text-primary);
  }

  .token-contract-copy-btn.copied {
    color: var(--status-success-text);
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

  .edit-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      border-color 0.2s ease,
      color 0.2s ease,
      background 0.2s ease;
  }

  .edit-btn:hover {
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

  .swap-panel :global(.swap-card) {
    border: 1.2px solid var(--border-color);
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
