<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { ChevronDown, Globe, Plus } from "lucide-svelte";
  import { siTelegram, siX } from "simple-icons";
  import Spinner from "../../lib/Spinner.svelte";
  import { tokenHubStore } from "../../lib/tokenHubStore";
  import type { TokenInfo } from "../../lib/types";
  import {
    DEX_BACKEND_API,
    formatCompact,
    getTokenIcon,
  } from "../../lib/utils";
  import { walletStore } from "../../lib/walletStore";

  const LAUNCH_SORT_STORAGE_KEY = "dex-launch-sort-settings";

  type LaunchSortBy = "newest" | "marketCap" | "volume";
  interface LaunchApiTokenData {
    x: string | null;
    telegram: string | null;
    website: string | null;
    description: string | null;
    launched_by: string;
    launched_at_ns: number;
  }
  type LaunchApiResponse = Record<string, LaunchApiTokenData>;

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

  function hasAnySocialLinks(data: LaunchApiTokenData): boolean {
    return Boolean(data.x || data.telegram || data.website);
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
      .filter((token) => token.launchData !== null),
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

  async function fetchLaunchData(): Promise<void> {
    launchApiError = null;
    isLaunchApiLoading = true;

    try {
      const response = await fetch(`${DEX_BACKEND_API}/launch/launch-data`);
      if (!response.ok) {
        throw new Error(`Failed to fetch launch data: HTTP ${response.status}`);
      }
      launchDataByTokenId = (await response.json()) as LaunchApiResponse;
    } catch (error) {
      launchApiError =
        error instanceof Error ? error.message : "Failed to fetch launch data";
      launchDataByTokenId = {};
    } finally {
      isLaunchApiLoading = false;
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

  function openToken(tokenId: string): void {
    void goto(`/launch?token=${encodeURIComponent(tokenId)}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
      invalidateAll: false,
    });
  }

  function handleTokenCardKeydown(event: KeyboardEvent, tokenId: string): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openToken(tokenId);
  }

  function stopCardNavigation(event: MouseEvent): void {
    event.stopPropagation();
  }

  onMount(() => {
    const loaded = loadSortSettings();
    if (loaded.sortBy !== undefined) sortBy = loaded.sortBy;
    if (loaded.ownedFirst !== undefined) ownedFirst = loaded.ownedFirst;
    hasRestoredSortSettings = true;

    void reloadPageData();
  });

  $effect(() => {
    sortBy;
    ownedFirst;
    hasRestoredSortSettings;
    if (hasRestoredSortSettings) {
      saveSortSettings(sortBy, ownedFirst);
    }
  });
</script>

<div class="launch-page">
  <div class="page-header">
    <div class="page-heading">
      <h2>Launchpad</h2>
      <p>Anyone can launch their token here. DYOR before buying.</p>
    </div>
    <div class="header-actions" class:mobile-config-open={isMobileSortOpen}>
      <div
        class="sort-settings"
        role="group"
        aria-label="Launch sorting settings"
      >
        <div class="sort-by-control">
          <span class="sort-by-label">Sort by</span>
          <button
            type="button"
            class="sort-cycle-btn"
            onclick={cycleSortBy}
            aria-label={`Sort by ${SORT_BY_LABELS[sortBy]}. Activate to cycle sort mode.`}
          >
            {SORT_BY_LABELS[sortBy]}
          </button>
        </div>
        <label
          class="filter-toggle"
          class:disabled={!$walletStore.isConnected}
          for="launch-owned-first-toggle"
        >
          <input
            id="launch-owned-first-toggle"
            type="checkbox"
            bind:checked={ownedFirst}
            disabled={!$walletStore.isConnected}
          />
          <span>Owned First</span>
        </label>
      </div>
      <button
        type="button"
        class="create-token-btn"
        disabled
        aria-disabled="true"
        title="Create Token coming soon"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
        <span>Create Token</span>
      </button>

      <div class="mobile-sort-controls">
        <div class="mobile-sort-row">
          <button
            type="button"
            class="mobile-sort-toggle"
            aria-expanded={isMobileSortOpen}
            onclick={toggleMobileSort}
          >
            <span>Sort By</span>
            <span class="mobile-sort-chevron" class:open={isMobileSortOpen}>
              <ChevronDown size={16} />
            </span>
          </button>
          <button
            type="button"
            class="mobile-create-token-btn"
            disabled
            aria-disabled="true"
            title="Create Token coming soon"
          >
            <Plus size={16} />
          </button>
        </div>

      </div>
    </div>
  </div>

  {#if isInitialLoading}
    <div class="state-panel loading">
      <Spinner size={30} borderWidth={3} />
      <p>Loading launch tokens...</p>
    </div>
  {:else if combinedError}
    <div class="state-panel error">
      <p>{combinedError}</p>
      <button type="button" onclick={() => reloadPageData()}> Retry </button>
    </div>
  {:else if visibleLaunchTokens.length === 0}
    <div class="state-panel empty">
      <p>No launch tokens found.</p>
    </div>
  {:else}
    <div class="token-list">
      {#each visibleLaunchTokens as token (token.token.account_id)}
        {@const iconSrc = getTokenIcon(token.token)}
        <div
          class="token-card"
          class:selected={selectedTokenId === token.token.account_id}
          role="link"
          tabindex="0"
          onclick={() => openToken(token.token.account_id)}
          onkeydown={(event) =>
            handleTokenCardKeydown(event, token.token.account_id)}
        >
          <div class="token-icon-shell">
            {#if iconSrc}
              <img
                src={iconSrc}
                alt={`${token.token.metadata.symbol} token`}
                class="token-icon-image"
              />
            {:else}
              <div class="token-icon-placeholder">
                {token.token.metadata.symbol.charAt(0) || "?"}
              </div>
            {/if}
          </div>
          <div class="token-content">
            <div class="name-and-symbol">
              <div class="name-row">
                <span class="token-name">{token.token.metadata.name}</span>
                <span class="token-mcap-inline">
                  mcap {formatUsdCompact(getMarketCap(token.token))}
                </span>
                <a
                  href={`https://nearblocks.io/address/${token.launchData.launched_by}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="launched-by-inline"
                  title={token.launchData.launched_by}
                  onclick={stopCardNavigation}
                >
                  {token.launchData.launched_by}
                </a>
              </div>
              <span class="token-symbol-row">{token.token.metadata.symbol}</span
              >
            </div>
            <div class="meta-row">
              {#if token.launchData.description !== null}
                <p class="token-description">
                  {token.launchData.description}
                </p>
              {/if}
              <div class="token-right">
                <span class="launched-by-label">by</span>
                <a
                  href={`https://nearblocks.io/address/${token.launchData.launched_by}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="launched-by-btn"
                  title={token.launchData.launched_by}
                  onclick={stopCardNavigation}
                >
                  {token.launchData.launched_by}
                </a>
                <span class="mcap-mobile-label">mcap</span>
                <span class="mcap-mobile-value">
                  {formatUsdCompact(getMarketCap(token.token))}
                </span>
                {#if hasAnySocialLinks(token.launchData)}
                  <div class="token-links">
                    {#if token.launchData.x !== null}
                      <a
                        href={token.launchData.x}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="token-link-btn"
                        aria-label="Token X"
                        onclick={stopCardNavigation}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          role="img"
                        >
                          <path d={siX.path} />
                        </svg>
                      </a>
                    {/if}
                    {#if token.launchData.telegram !== null}
                      <a
                        href={token.launchData.telegram}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="token-link-btn"
                        aria-label="Token Telegram"
                        onclick={stopCardNavigation}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          role="img"
                        >
                          <path d={siTelegram.path} />
                        </svg>
                      </a>
                    {/if}
                    {#if token.launchData.website !== null}
                      <a
                        href={token.launchData.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="token-link-btn"
                        aria-label="Token Website"
                        onclick={stopCardNavigation}
                      >
                        <Globe size={14} />
                      </a>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
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

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
  }

  .page-heading h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .page-heading p {
    margin: 0.4rem 0 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  .header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .sort-settings {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.45rem 0.65rem;
  }

  .sort-by-control {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .sort-by-label {
    font-size: 0.9rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .sort-cycle-btn {
    width: 7rem;
    min-width: 7rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 0.4rem;
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 0.9rem;
    font-weight: 500;
    margin-left: 0.25rem;
    cursor: pointer;
    text-align: center;
    transition:
      background 0.2s ease,
      border-color 0.2s ease,
      filter 0.2s ease;
  }

  .sort-cycle-btn:hover {
    border-color: var(--border-color);
    filter: brightness(1.25);
  }

  .sort-cycle-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .filter-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }

  .filter-toggle.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .filter-toggle input {
    margin: 0;
    accent-color: var(--accent-primary);
  }

  .create-token-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.52rem 1rem;
    background: var(--accent-button-small);
    border: none;
    border-radius: 0.5rem;
    color: var(--text-on-accent);
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .create-token-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .create-token-btn svg {
    flex-shrink: 0;
  }

  .mobile-sort-controls {
    display: none;
    width: 100%;
  }

  .mobile-sort-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
    width: 100%;
  }

  .mobile-sort-toggle {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.4rem;
    padding: 0.45rem 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }

  .mobile-sort-chevron {
    color: var(--text-secondary);
    transition: transform 0.2s ease;
  }

  .mobile-sort-chevron.open {
    transform: rotate(180deg);
  }

  .mobile-create-token-btn {
    width: 2.25rem;
    height: 2.25rem;
    border: none;
    border-radius: 0.5rem;
    background: var(--accent-button-small);
    color: var(--text-on-accent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .mobile-create-token-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .token-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 0.75rem;
  }

  .token-card {
    --token-card-height: 132px;
    --token-card-padding: 0.625rem;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    color: inherit;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 0.9rem;
    height: var(--token-card-height);
    padding: var(--token-card-padding);
    transition:
      border-color 0.2s ease,
      background 0.2s ease,
      box-shadow 0.2s ease;
    cursor: pointer;
    overflow: hidden;
  }

  .token-card:hover {
    border-color: var(--accent-primary);
    background: var(--bg-secondary);
    box-shadow: 0 8px 18px rgba(59, 130, 246, 0.14);
  }

  .token-card.selected {
    border-color: var(--accent-primary);
    box-shadow: inset 0 0 0 1px var(--accent-primary);
  }

  .token-icon-shell {
    width: calc(var(--token-card-height) - (var(--token-card-padding) * 2));
    height: calc(var(--token-card-height) - (var(--token-card-padding) * 2));
    border-radius: 0.7rem;
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
    transform-origin: center;
  }

  .token-icon-placeholder {
    background: linear-gradient(
      135deg,
      var(--accent-gradient-start),
      var(--accent-gradient-end)
    );
    color: var(--text-on-accent);
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .token-content {
    min-width: 0;
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .name-and-symbol {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .token-name {
    flex: 1;
    color: var(--text-primary);
    font-weight: 600;
    font-size: 1.05rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .token-symbol-row {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-family: "JetBrains Mono", monospace;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .token-mcap-inline {
    color: var(--text-secondary);
    font-size: 0.84rem;
    font-family: "JetBrains Mono", monospace;
    margin-left: auto;
    text-align: right;
    width: max-content;
    white-space: nowrap;
    flex-shrink: 0;
    text-transform: uppercase;
  }

  .launched-by-inline {
    display: none;
    max-width: 45%;
    color: var(--text-primary);
    text-decoration: none;
    font-weight: 500;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.74rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0;
  }

  .launched-by-inline:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .meta-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
    min-width: 0;
  }

  .token-description {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.86rem;
    line-height: 1.35;
    flex: 1;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    line-clamp: 3;
    overflow: hidden;
  }

  .token-right {
    min-width: 140px;
    max-width: 160px;
  }

  .launched-by-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .launched-by-btn {
    max-width: 100%;
    padding: 0.2rem 0.42rem;
    color: var(--text-primary);
    text-decoration: none;
    font-weight: 500;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.78rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .launched-by-btn:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .mcap-mobile-label,
  .mcap-mobile-value {
    display: none;
  }

  .token-links {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.35rem;
    margin-top: 0.35rem;
  }

  .token-link-btn {
    text-decoration: none;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.45rem;
    width: 1.55rem;
    height: 1.55rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
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

  @media (max-width: 1024px) {
    .page-header {
      align-items: flex-start;
    }

    .header-actions {
      width: 100%;
      justify-content: flex-start;
    }
  }

  @media (max-width: 460px) {
    .sort-settings {
      width: 100%;
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }

    .sort-by-control {
      justify-content: space-between;
    }

    .sort-cycle-btn {
      min-width: 0;
      width: 7rem;
    }
  }

  @media (max-width: 400px) {
    .create-token-btn span {
      display: none;
    }
  }

  @media (max-width: 360px) {
    .sort-by-control {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.25rem;
    }

    .sort-cycle-btn {
      margin-left: 0;
    }
  }

  @media (--tablet) {
    .launch-page {
      padding: 0;
    }
  }

  @media (--mobile) {
    .token-list {
      grid-template-columns: 1fr;
    }

    .token-card {
      --token-card-height: 130px;
      --token-card-padding: 0.5rem;
      height: auto;
      min-height: 130px;
      align-items: stretch;
      position: relative;
      gap: 0;
    }

    .token-icon-shell {
      width: 64px;
      height: 64px;
      border-radius: 0.5rem;
      position: absolute;
      left: var(--token-card-padding);
      bottom: var(--token-card-padding);
    }

    .token-name {
      font-size: 0.95rem;
    }

    .token-content {
      height: auto;
      min-height: 64px;
      gap: 0.22rem;
    }

    .name-row {
      gap: 0.35rem;
    }

    .token-symbol-row {
      font-size: 0.75rem;
    }

    .meta-row {
      gap: 0.5rem;
      margin-left: calc(64px + 0.5rem);
      min-height: 64px;
    }

    .token-description {
      font-size: 0.8rem;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }

    .token-right {
      min-width: max-content;
      max-width: max-content;
      margin-left: auto;
    }

    .token-mcap-inline {
      display: none;
    }

    .launched-by-inline {
      display: inline-block;
    }

    .launched-by-label,
    .launched-by-btn {
      display: none;
    }

    .mcap-mobile-label {
      display: block;
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .mcap-mobile-value {
      display: block;
      color: var(--text-primary);
      font-weight: 600;
      font-family: "JetBrains Mono", monospace;
      font-size: 0.82rem;
      white-space: nowrap;
      text-align: right;
      width: max-content;
    }

    .token-links {
      gap: 0.3rem;
      margin-top: 0.2rem;
    }

    .header-actions {
      width: 100%;
      flex-direction: column;
      align-items: stretch;
      gap: 0.35rem;
    }

    .sort-settings {
      display: none;
      order: 2;
      width: 100%;
      padding: 0;
      gap: 0.55rem;
      background: transparent;
    }

    .header-actions.mobile-config-open .sort-settings {
      display: flex;
      align-items: stretch;
      flex-wrap: wrap;
      width: 100%;
      flex-direction: column;
    }

    .header-actions.mobile-config-open .sort-by-control {
      width: 100%;
      justify-content: space-between;
    }

    .header-actions.mobile-config-open .sort-cycle-btn {
      width: 100%;
      min-width: 0;
      margin-left: 0;
    }

    .header-actions.mobile-config-open .filter-toggle {
      width: auto;
      justify-content: flex-start;
      align-self: flex-start;
    }

    .create-token-btn {
      display: none;
    }

    .mobile-sort-controls {
      display: block;
      order: 1;
      width: 100%;
    }
  }
</style>
