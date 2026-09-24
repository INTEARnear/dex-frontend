<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import Spinner from "../../lib/Spinner.svelte";
  import { tokenHubStore } from "../../lib/tokenHubStore";
  import type { TokenInfo } from "../../lib/types";
  import { formatCompact } from "../../lib/utils";
  import { walletStore } from "../../lib/walletStore";
  import LaunchListView from "$lib/launch/LaunchListView.svelte";
  import LaunchTokenDetailView from "$lib/launch/LaunchTokenDetailView.svelte";
  import type { LaunchInfo, LaunchSortBy } from "$lib/launch/types";
  import { fetchLaunchInfo, isLaunchToken } from "$lib/launch/launchContracts";
  import CreateTokenModal from "$lib/launch/CreateTokenModal.svelte";
  import EditTokenModal from "$lib/launch/EditTokenModal.svelte";
  import { scoreTermAgainstToken } from "$lib/tokenSearch";

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

  interface StoredLaunchSortSettings {
    sortBy: LaunchSortBy;
    ownedFirst: boolean;
  }

  interface ScoredLaunchToken {
    token: TokenInfo;
    searchScore: number;
  }

  function loadSortSettings(): StoredLaunchSortSettings {
    try {
      const raw = localStorage.getItem(LAUNCH_SORT_STORAGE_KEY);
      if (!raw) return { sortBy: "volume", ownedFirst: true };
      const parsed = JSON.parse(raw) as StoredLaunchSortSettings;
      return parsed;
    } catch {
      return { sortBy: "volume", ownedFirst: true };
    }
  }

  function saveSortSettings(sortBy: LaunchSortBy, ownedFirst: boolean): void {
    localStorage.setItem(
      LAUNCH_SORT_STORAGE_KEY,
      JSON.stringify({ sortBy, ownedFirst }),
    );
  }

  const selectedTokenId = $derived(page.url.searchParams.get("token"));
  let hasTokenApiReturned = $state(false);

  let sortBy = $state<LaunchSortBy>("volume");
  let ownedFirst = $state(true);
  let searchQuery = $state("");
  let showCreateTokenModal = $state(false);
  let showEditTokenModal = $state(false);
  let hasRestoredSortSettings = $state(false);

  const launchTokens = $derived.by(() =>
    $tokenHubStore.tokens.filter((token) => isLaunchToken(token.account_id)),
  );

  const combinedError = $derived($tokenHubStore.errors.tokens);
  const isInitialLoading = $derived(!hasTokenApiReturned);

  const visibleLaunchTokens = $derived.by(() => {
    const scoredEntries: ScoredLaunchToken[] =
      searchQuery.trim().length === 0
        ? launchTokens.map((token) => ({ token, searchScore: 0 }))
        : launchTokens
            .map((token) => {
              const searchScore = scoreTermAgainstToken(searchQuery, {
                name: token.metadata.name,
                symbol: token.metadata.symbol,
              });
              if (searchScore === null) return null;
              return { token, searchScore };
            })
            .filter((entry): entry is ScoredLaunchToken => entry !== null && entry.searchScore > 0);

    scoredEntries.sort((left, right) => {
      if (
        searchQuery.trim().length > 0 &&
        left.searchScore !== right.searchScore
      ) {
        return right.searchScore - left.searchScore;
      }
      return compareLaunchTokensForSort(left.token, right.token);
    });

    return scoredEntries.map(({ token }) => token);
  });

  const selectedToken = $derived.by(() => {
    if (!selectedTokenId || !isLaunchToken(selectedTokenId)) return null;
    return $tokenHubStore.tokensById[selectedTokenId] ?? null;
  });
  const showTokenDetail = $derived(selectedToken !== null);

  // Description, social links and creator are only read from the launch
  // contract for the token that is open, not for the whole list
  let selectedLaunchData = $state<LaunchInfo | null>(null);
  let activeLaunchInfoRequestId = 0;

  async function loadSelectedLaunchData(tokenId: string): Promise<void> {
    const requestId = ++activeLaunchInfoRequestId;
    try {
      const launchInfo = await fetchLaunchInfo(tokenId);
      if (requestId !== activeLaunchInfoRequestId) return;
      selectedLaunchData = launchInfo;
    } catch (error) {
      if (requestId !== activeLaunchInfoRequestId) return;
      console.error(`Failed to fetch launch data of ${tokenId}:`, error);
    }
  }

  $effect(() => {
    const tokenId = selectedTokenId;
    selectedLaunchData = null;
    activeLaunchInfoRequestId += 1;
    if (tokenId && isLaunchToken(tokenId)) {
      void loadSelectedLaunchData(tokenId);
    }
  });

  const isSelectedTokenPending = $derived(
    selectedTokenId !== null && isLaunchToken(selectedTokenId) && !showTokenDetail,
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

  function compareLaunchTokensForSort(
    left: TokenInfo,
    right: TokenInfo,
  ): number {
    // Block height at which the token was created
    const leftLaunchedAt = left.created_at ?? 0;
    const rightLaunchedAt = right.created_at ?? 0;

    if (ownedFirst && $walletStore.isConnected) {
      const leftOwned = hasOwnedBalance(left);
      const rightOwned = hasOwnedBalance(right);
      if (leftOwned !== rightOwned) return rightOwned ? 1 : -1;
      if (leftOwned && rightOwned) {
        const balanceDiff = (right.balanceUsd ?? 0) - (left.balanceUsd ?? 0);
        if (Math.abs(balanceDiff) > 0.000001) return balanceDiff;
      }
    }

    if (sortBy === "newest") {
      if (leftLaunchedAt !== rightLaunchedAt)
        return rightLaunchedAt - leftLaunchedAt;
    } else if (sortBy === "marketCap") {
      const mcapDiff = (getMarketCap(right) ?? -1) - (getMarketCap(left) ?? -1);
      if (Math.abs(mcapDiff) > 0.000001) return mcapDiff;
    } else {
      const volumeDiff = right.volume_usd_24h - left.volume_usd_24h;
      if (Math.abs(volumeDiff) > 0.000001) return volumeDiff;
    }

    const mcapDiff = (getMarketCap(right) ?? -1) - (getMarketCap(left) ?? -1);
    if (Math.abs(mcapDiff) > 0.000001) return mcapDiff;
    const volumeDiff = right.volume_usd_24h - left.volume_usd_24h;
    if (Math.abs(volumeDiff) > 0.000001) return volumeDiff;
    if (leftLaunchedAt !== rightLaunchedAt)
      return rightLaunchedAt - leftLaunchedAt;
    return left.metadata.name.localeCompare(right.metadata.name);
  }

  function cycleSortBy(): void {
    sortBy = NEXT_SORT_BY[sortBy];
  }

  function setSearchQuery(next: string): void {
    searchQuery = next;
  }

  function setOwnedFirst(next: boolean): void {
    ownedFirst = next;
  }

  function openCreateTokenModal(): void {
    showCreateTokenModal = true;
  }

  async function fetchTokenData(options?: {
    background?: boolean;
  }): Promise<void> {
    const background = options?.background ?? false;
    if (!background) hasTokenApiReturned = false;
    try {
      await tokenHubStore.refreshTokens();
    } finally {
      if (!background) hasTokenApiReturned = true;
    }
  }

  async function reloadPageData(): Promise<void> {
    await fetchTokenData();
  }

  onMount(() => {
    tokenHubStore.updatePricesEvery(1_000);
    tokenHubStore.updateBalancesEvery(1_000);

    const loaded = loadSortSettings();
    sortBy = loaded.sortBy;
    ownedFirst = loaded.ownedFirst;
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

  let tokenDataRefreshInFlight = $state(false);
  let selectedTokenRefreshInFlight = $state(false);
  $effect(() => {
    const refreshTimer = setInterval(() => {
      if (!tokenDataRefreshInFlight) {
        tokenDataRefreshInFlight = true;
        fetchTokenData({ background: true }).finally(() => {
          tokenDataRefreshInFlight = false;
        });
      }

      if (
        selectedTokenId &&
        isLaunchToken(selectedTokenId) &&
        !showTokenDetail &&
        !selectedTokenRefreshInFlight
      ) {
        selectedTokenRefreshInFlight = true;
        tokenHubStore.ensureTokenById(selectedTokenId).finally(() => {
          selectedTokenRefreshInFlight = false;
        });
      }
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
  {:else if showTokenDetail && selectedToken}
    <LaunchTokenDetailView
      token={selectedToken}
      launchData={selectedLaunchData}
      marketCap={formatMarketCap(selectedToken)}
      onEditClick={() => {
        showEditTokenModal = true;
      }}
    />
  {:else if isSelectedTokenPending}
    <div class="state-panel loading">
      <Spinner size={30} borderWidth={3} />
      <p>Loading selected token data...</p>
    </div>
  {:else if visibleLaunchTokens.length === 0}
    <div class="state-panel empty">
      <p>
        {searchQuery.trim()
          ? "No launch tokens match your search."
          : "No launch tokens found."}
      </p>
    </div>
  {:else}
    <LaunchListView
      {visibleLaunchTokens}
      {selectedTokenId}
      sortByLabel={SORT_BY_LABELS[sortBy]}
      {searchQuery}
      {ownedFirst}
      onCreateTokenClick={openCreateTokenModal}
      onCycleSortBy={cycleSortBy}
      onSearchQueryChange={setSearchQuery}
      onOwnedFirstChange={setOwnedFirst}
      {formatMarketCap}
    />
  {/if}
</div>

<CreateTokenModal
  isOpen={showCreateTokenModal}
  onClose={() => (showCreateTokenModal = false)}
  onSuccess={(tokenId) => goto(`/launch?token=${encodeURIComponent(tokenId)}`)}
/>

{#if showTokenDetail && selectedToken && selectedLaunchData}
  <EditTokenModal
    isOpen={showEditTokenModal}
    tokenAccountId={selectedToken.account_id}
    initialLaunchData={selectedLaunchData}
    onClose={() => (showEditTokenModal = false)}
    onSuccess={() => {
      showEditTokenModal = false;
      void loadSelectedLaunchData(selectedToken.account_id);
    }}
  />
{/if}

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
