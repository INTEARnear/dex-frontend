<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import Spinner from "../../lib/Spinner.svelte";
  import { tokenHubStore } from "../../lib/tokenHubStore";
  import type { TokenInfo } from "../../lib/types";
  import { DEX_BACKEND_API, formatCompact } from "../../lib/utils";
  import { walletStore } from "../../lib/walletStore";
  import LaunchListView from "./components/LaunchListView.svelte";
  import LaunchTokenDetailView from "./components/LaunchTokenDetailView.svelte";
  import type {
    LaunchApiResponse,
    LaunchSortBy,
    LaunchApiTokenData,
    LaunchToken,
  } from "./types";

  const LAUNCH_SORT_STORAGE_KEY = "dex-launch-sort-settings";

  const SORT_BY_LABELS: Record<LaunchSortBy, string> = {
    newest: "Newest",
    marketCap: "Market Cap",
    volume: "Volume",
  };
  const NEXT_SORT_BY: Record<LaunchSortBy, LaunchSortBy> = {
    newest: "marketCap",
    marketCap: "volume",
    volume: "newest",
  };

  function loadSortSettings(): Partial<{
    sortBy: LaunchSortBy;
    ownedFirst: boolean;
  }> {
    try {
      const raw = localStorage.getItem(LAUNCH_SORT_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Partial<{ sortBy: LaunchSortBy; ownedFirst: boolean }> = {};

      if (
        parsed.sortBy === "newest" ||
        parsed.sortBy === "marketCap" ||
        parsed.sortBy === "volume"
      ) {
        out.sortBy = parsed.sortBy;
      }
      if (typeof parsed.ownedFirst === "boolean") {
        out.ownedFirst = parsed.ownedFirst;
      }

      return out;
    } catch {
      return {};
    }
  }

  function saveSortSettings(sortBy: LaunchSortBy, ownedFirst: boolean): void {
    localStorage.setItem(
      LAUNCH_SORT_STORAGE_KEY,
      JSON.stringify({ sortBy, ownedFirst }),
    );
  }

  const selectedTokenId = $derived(page.url.searchParams.get("token"));
  let launchDataByTokenId = $state<Record<string, LaunchApiTokenData>>({});
  let isLaunchApiLoading = $state(true);
  let launchApiError = $state<string | null>(null);
  let hasTokenApiReturned = $state(false);

  let sortBy = $state<LaunchSortBy>("volume");
  let ownedFirst = $state(true);
  let isMobileSortOpen = $state(false);
  let hasRestoredSortSettings = $state(false);

  const launchTokens = $derived.by(() =>
    $tokenHubStore.tokens.filter(
      (token) => launchDataByTokenId[token.account_id] !== undefined,
    ),
  );

  const combinedError = $derived(
    launchApiError ?? $tokenHubStore.errors.tokens,
  );
  const isInitialLoading = $derived(!hasTokenApiReturned || isLaunchApiLoading);

  const visibleLaunchTokens = $derived.by(() =>
    launchTokens
      .slice()
      .sort((left, right) => {
        const leftLaunch = launchDataByTokenId[left.account_id] ?? null;
        const rightLaunch = launchDataByTokenId[right.account_id] ?? null;
        const leftLaunchedAtNs = leftLaunch?.launched_at_ns ?? 0;
        const rightLaunchedAtNs = rightLaunch?.launched_at_ns ?? 0;

        if (ownedFirst && $walletStore.isConnected) {
          const leftOwned = hasOwnedBalance(left);
          const rightOwned = hasOwnedBalance(right);
          if (leftOwned !== rightOwned) return rightOwned ? 1 : -1;
          if (leftOwned && rightOwned) {
            const balanceDiff =
              (right.balanceUsd ?? 0) - (left.balanceUsd ?? 0);
            if (Math.abs(balanceDiff) > 0.000001) return balanceDiff;
          }
        }

        if (sortBy === "newest") {
          if (leftLaunchedAtNs !== rightLaunchedAtNs)
            return rightLaunchedAtNs - leftLaunchedAtNs;
        } else if (sortBy === "marketCap") {
          const mcapDiff =
            (getMarketCap(right) ?? -1) - (getMarketCap(left) ?? -1);
          if (Math.abs(mcapDiff) > 0.000001) return mcapDiff;
        } else {
          const volumeDiff = right.volume_usd_24h - left.volume_usd_24h;
          if (Math.abs(volumeDiff) > 0.000001) return volumeDiff;
        }

        const mcapDiff =
          (getMarketCap(right) ?? -1) - (getMarketCap(left) ?? -1);
        if (Math.abs(mcapDiff) > 0.000001) return mcapDiff;
        const volumeDiff = right.volume_usd_24h - left.volume_usd_24h;
        if (Math.abs(volumeDiff) > 0.000001) return volumeDiff;
        if (leftLaunchedAtNs !== rightLaunchedAtNs)
          return rightLaunchedAtNs - leftLaunchedAtNs;
        return left.metadata.name.localeCompare(right.metadata.name);
      })
      .map((token) => ({
        token,
        launchData: launchDataByTokenId[token.account_id] ?? null,
      }))
      .filter(
        (launchToken): launchToken is LaunchToken =>
          launchToken.launchData !== null,
      ),
  );

  const selectedToken = $derived.by(() => {
    if (!selectedTokenId) return null;
    return $tokenHubStore.tokensById[selectedTokenId] ?? null;
  });
  const selectedLaunchData = $derived.by(() => {
    if (!selectedTokenId) return null;
    return launchDataByTokenId[selectedTokenId] ?? null;
  });
  const showTokenDetail = $derived(
    selectedToken !== null && selectedLaunchData !== null,
  );

  const attemptedIconLoads = new Set<string>();
  $effect(() => {
    const missingIcons = launchTokens.filter(
      (token) =>
        !token.metadata.icon?.startsWith("data:") &&
        !attemptedIconLoads.has(token.account_id),
    );
    if (missingIcons.length === 0) return;

    for (const token of missingIcons) {
      attemptedIconLoads.add(token.account_id);
      void tokenHubStore.ensureTokenById(token.account_id);
    }
  });

  function getMarketCap(token: TokenInfo): number | null {
    const circulatingRaw = Number(token.circulating_supply);
    const decimalsFactor = Math.pow(10, token.metadata.decimals);
    const circulatingSupply = circulatingRaw / decimalsFactor;
    const price = Number(token.price_usd);
    const marketCap = circulatingSupply * price;

    if (
      !Number.isFinite(circulatingSupply) ||
      !Number.isFinite(price) ||
      !Number.isFinite(marketCap) ||
      marketCap < 0
    ) {
      return null;
    }

    return marketCap;
  }

  function formatUsdCompact(value: number | null): string {
    if (value === null) return "N/A";
    if (value === 0) return "$0";
    if (value < 1) return "<$1";
    if (value < 1e3) return `$${formatCompact(value)}`;
    if (value < 1e6) return `$${formatCompact(value / 1e3)}K`;
    if (value < 1e9) return `$${formatCompact(value / 1e6)}M`;
    if (value < 1e12) return `$${formatCompact(value / 1e9)}B`;
    return `$${formatCompact(value / 1e12)}T`;
  }

  function formatMarketCap(token: TokenInfo): string {
    return formatUsdCompact(getMarketCap(token));
  }

  function hasOwnedBalance(token: TokenInfo): boolean {
    if (!token.balance) return false;
    try {
      return BigInt(token.balance) > 0n;
    } catch {
      return false;
    }
  }

  function cycleSortBy(): void {
    sortBy = NEXT_SORT_BY[sortBy];
  }

  function toggleMobileSort(): void {
    isMobileSortOpen = !isMobileSortOpen;
  }

  function setOwnedFirst(next: boolean): void {
    ownedFirst = next;
  }

  async function fetchLaunchData(options?: {
    background?: boolean;
  }): Promise<void> {
    const background = options?.background ?? false;
    if (!background) {
      launchApiError = null;
      isLaunchApiLoading = true;
    }

    try {
      const response = await fetch(`${DEX_BACKEND_API}/launch/launch-data`);
      if (!response.ok) {
        throw new Error(`Failed to fetch launch data: HTTP ${response.status}`);
      }
      launchDataByTokenId = (await response.json()) as LaunchApiResponse;
      launchApiError = null;
    } catch (error) {
      if (!background) {
        launchApiError =
          error instanceof Error ? error.message : "Failed to fetch launch data";
        launchDataByTokenId = {};
      }
    } finally {
      if (!background) {
        isLaunchApiLoading = false;
      }
    }
  }

  async function fetchTokenData(): Promise<void> {
    hasTokenApiReturned = false;
    try {
      await tokenHubStore.refreshTokens();
    } finally {
      hasTokenApiReturned = true;
    }
  }

  async function reloadPageData(): Promise<void> {
    await Promise.all([fetchTokenData(), fetchLaunchData()]);
  }

  onMount(() => {
    tokenHubStore.updatePricesEvery(1_000);

    const loaded = loadSortSettings();
    if (loaded.sortBy !== undefined) sortBy = loaded.sortBy;
    if (loaded.ownedFirst !== undefined) ownedFirst = loaded.ownedFirst;
    hasRestoredSortSettings = true;
    reloadPageData();
  });

  $effect(() => {
    sortBy;
    ownedFirst;
    hasRestoredSortSettings;
    if (hasRestoredSortSettings) {
      saveSortSettings(sortBy, ownedFirst);
    }
  });

  let launchDataRefreshInFlight = $state(false);
  $effect(() => {
    if (showTokenDetail) return;

    const refreshTimer = setInterval(() => {
      if (launchDataRefreshInFlight) return;
      launchDataRefreshInFlight = true;
      fetchLaunchData({ background: true }).finally(() => {
        launchDataRefreshInFlight = false;
      });
    }, 1000);

    return () => {
      clearInterval(refreshTimer);
    };
  });
</script>

<div class="launch-page">
  {#if isInitialLoading}
    <div class="state-panel loading">
      <Spinner size={30} borderWidth={3} />
      <p>Loading launch tokens...</p>
    </div>
  {:else if combinedError}
    <div class="state-panel error">
      <p>{combinedError}</p>
      <button type="button" onclick={() => reloadPageData()}>Retry</button>
    </div>
  {:else if visibleLaunchTokens.length === 0}
    <div class="state-panel empty">
      <p>No launch tokens found.</p>
    </div>
  {:else if showTokenDetail && selectedToken && selectedLaunchData}
    <LaunchTokenDetailView
      token={selectedToken}
      launchData={selectedLaunchData}
      marketCap={formatMarketCap(selectedToken)}
    />
  {:else}
    <LaunchListView
      {visibleLaunchTokens}
      {selectedTokenId}
      sortByLabel={SORT_BY_LABELS[sortBy]}
      {isMobileSortOpen}
      {ownedFirst}
      walletConnected={$walletStore.isConnected}
      onCycleSortBy={cycleSortBy}
      onToggleMobileSort={toggleMobileSort}
      onOwnedFirstChange={setOwnedFirst}
      {formatMarketCap}
    />
  {/if}
</div>

<style>
  .launch-page {
    width: 100%;
    max-width: 1400px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0 1rem;
  }

  .state-panel {
    width: 100%;
    min-height: 180px;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-secondary);
    padding: 1rem;
    text-align: center;
  }

  .state-panel p {
    margin: 0;
  }

  .state-panel.error p {
    color: var(--status-error-text);
  }

  .state-panel button {
    padding: 0.45rem 0.85rem;
    border: none;
    border-radius: 0.5rem;
    background: var(--accent-button-small);
    color: var(--text-on-accent);
    font-weight: 600;
    cursor: pointer;
  }

  .state-panel button:hover {
    background: var(--accent-hover);
  }

  @media (--tablet) {
    .launch-page {
      padding: 0;
    }
  }
</style>
