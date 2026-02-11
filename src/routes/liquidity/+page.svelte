<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { NEAR_TOKEN } from "../../lib/tokenStore";
  import { walletStore } from "../../lib/walletStore";
  import { PRICES_API, formatCompact } from "../../lib/utils";
  import type { Token, AssetWithBalance, XykPool } from "../../lib/types";
  import CreatePoolModal from "../../lib/CreatePoolModal.svelte";
  import TokenBadge from "../../lib/TokenBadge.svelte";

  const DEX_BACKEND_API = "https://dex-backend.intear.tech";

  interface PoolDisplay {
    id: number;
    ownerId?: string;
    assets: [AssetWithBalance, AssetWithBalance];
    totalFeePercent: number;
    tokens: [Token | null, Token | null];
  }

  let pools = $state<PoolDisplay[]>([]);
  let isFetchingPools = $state(false);
  let isLoadingTokens = $state(false);
  let canDisplayPools = $state(false);
  const isLoading = $derived(
    isFetchingPools || (isLoadingTokens && !canDisplayPools),
  );
  let error = $state<string | null>(null);
  let tokenCache = $state<Map<string, Token | null>>(new Map());
  const pendingTokenRequests = new Map<string, Promise<Token | null>>();
  let tokenDisplayFallbackTimer: number | null = null;
  let showCreatePoolModal = $state(false);

  const accountId = $derived($walletStore.accountId);
  let isConnecting = $state(false);

  async function handleConnectWallet() {
    isConnecting = true;
    try {
      await walletStore.connect();
    } catch (e) {
      console.error("Connection failed:", e);
    } finally {
      isConnecting = false;
    }
  }

  function buildPoolsWithCachedTokens(poolList: PoolDisplay[]): PoolDisplay[] {
    return poolList.map((pool) => {
      const tokens: [Token | null, Token | null] = [
        tokenCache.get(pool.assets[0].asset_id) ?? null,
        tokenCache.get(pool.assets[1].asset_id) ?? null,
      ];

      return {
        ...pool,
        tokens,
      };
    });
  }

  function clearTokenDisplayFallbackTimer() {
    if (tokenDisplayFallbackTimer) {
      clearTimeout(tokenDisplayFallbackTimer);
      tokenDisplayFallbackTimer = null;
    }
  }

  function startTokenDisplayFallbackTimer(poolList: PoolDisplay[]) {
    clearTokenDisplayFallbackTimer();
    tokenDisplayFallbackTimer = window.setTimeout(() => {
      if (isLoadingTokens) {
        pools = buildPoolsWithCachedTokens(poolList);
        canDisplayPools = true;
      }
    }, 1000);
  }

  async function fetchTokenInfo(assetId: string): Promise<Token | null> {
    if (tokenCache.has(assetId)) {
      return tokenCache.get(assetId) ?? null;
    }

    const pendingRequest = pendingTokenRequests.get(assetId);
    if (pendingRequest) {
      return pendingRequest;
    }

    const request = (async () => {
      if (assetId === "near") {
        tokenCache.set(assetId, NEAR_TOKEN);
        return NEAR_TOKEN;
      }

      if (!assetId.startsWith("nep141:")) {
        tokenCache.set(assetId, null);
        return null;
      }

      const tokenId = assetId.replace(/^nep141:/, "");
      try {
        const response = await fetch(`${PRICES_API}/token?token_id=${tokenId}`);
        if (response.ok) {
          const data: Token = await response.json();
          if (!data.metadata.icon?.startsWith("data:")) {
            data.metadata.icon = undefined;
          }
          tokenCache.set(assetId, data);
          return data;
        }
      } catch (e) {
        console.error(`Failed to fetch token ${tokenId}:`, e);
      }

      tokenCache.set(assetId, null);
      return null;
    })();

    pendingTokenRequests.set(assetId, request);
    try {
      return await request;
    } finally {
      pendingTokenRequests.delete(assetId);
    }
  }

  function calculateLiquidityUsd(
    assets: [AssetWithBalance, AssetWithBalance],
    tokens: [Token | null, Token | null],
  ): number {
    let total = 0;
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const token = tokens[i];
      if (token) {
        const decimals = token.metadata.decimals;
        const balance = parseFloat(asset.balance) / Math.pow(10, decimals);
        const price = parseFloat(token.price_usd || "0");
        total += balance * price;
      }
    }
    return total;
  }

  function formatLiquidity(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "$0";
    if (value < 1) return "<$1";
    if (value < 1000) return `$${formatCompact(value)}`;
    if (value < 1e6) return `$${formatCompact(value / 1e3)}K`;
    if (value < 1e9) return `$${formatCompact(value / 1e6)}M`;
    return `$${formatCompact(value / 1e9)}B`;
  }

  async function fetchPools() {
    isFetchingPools = true;
    isLoadingTokens = false;
    canDisplayPools = false;
    error = null;

    try {
      const response = await fetch(`${DEX_BACKEND_API}/pools/all`);
      if (!response.ok) {
        throw new Error("Failed to fetch pools");
      }

      const data: XykPool[] = await response.json();

      const processedPools: PoolDisplay[] = [];

      for (const pool of data) {
        const fees =
          "Private" in pool.pool
            ? pool.pool.Private!.fees
            : pool.pool.Public!.fees;
        const totalFeePercent =
          fees.receivers
            .filter(([receiver]) => {
              // Exclude protocol fee from displayed fee
              if (typeof receiver === "object" && "Account" in receiver) {
                return receiver.Account !== "plach.intear.near";
              }
              return true;
            })
            .reduce((acc, [, fee]) => acc + fee, 0) / 10000;

        processedPools.push({
          id: pool.id,
          ownerId:
            "Private" in pool.pool ? pool.pool.Private!.owner_id : undefined,
          assets:
            "Private" in pool.pool
              ? pool.pool.Private!.assets
              : pool.pool.Public!.assets,
          totalFeePercent,
          tokens: [null, null],
        });
      }

      pools = processedPools;
      isFetchingPools = false;

      if (processedPools.length === 0) {
        canDisplayPools = true;
        return;
      }

      isLoadingTokens = true;
      startTokenDisplayFallbackTimer(processedPools);
      await loadAllPoolTokens(processedPools);
      isLoadingTokens = false;
      canDisplayPools = true;
      clearTokenDisplayFallbackTimer();
    } catch (e) {
      error = "Error getting pools, try again";
      console.error("Error fetching pools:", e);
      canDisplayPools = true;
      isLoadingTokens = false;
      clearTokenDisplayFallbackTimer();
    } finally {
      isFetchingPools = false;
    }
  }

  async function loadAllPoolTokens(poolList: PoolDisplay[]) {
    const uniqueAssetIds = Array.from(
      new Set(poolList.flatMap((pool) => pool.assets.map((a) => a.asset_id))),
    );

    await Promise.allSettled(
      uniqueAssetIds.map((assetId) => fetchTokenInfo(assetId)),
    );

    pools = buildPoolsWithCachedTokens(poolList);
  }

  onMount(() => {
    fetchPools();
  });

  onDestroy(() => {
    clearTokenDisplayFallbackTimer();
  });
</script>

<div class="liquidity-page">
  <div class="page-header">
    <h2>Plach Liquidity Pools</h2>
    <div class="header-actions">
      {#if $walletStore.isConnected}
        <button
          class="create-pool-btn"
          onclick={() => (showCreatePoolModal = true)}
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
          <span>Create Pool</span>
        </button>
      {:else}
        <button
          class="create-pool-btn"
          onclick={handleConnectWallet}
          disabled={isConnecting}
        >
          <span>{isConnecting ? "Connecting..." : "Connect Wallet"}</span>
        </button>
      {/if}
      <button
        class="refresh-btn"
        onclick={fetchPools}
        disabled={isLoading}
        aria-label="Refresh pools"
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
          class:spinning={isLoading}
        >
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M16 21h5v-5" />
        </svg>
      </button>
    </div>
  </div>

  {#if isLoading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading pools...</p>
    </div>
  {:else if error}
    <div class="error">
      <p>{error}</p>
      <button onclick={fetchPools}>Retry</button>
    </div>
  {:else if pools.length === 0}
    <div class="empty">
      <p>No pools found</p>
    </div>
  {:else}
    <div class="pools-grid">
      {#each pools as pool (pool.id)}
        <a
          href="/pool?id=PLACH-{pool.id}"
          class="pool-card"
          class:private={pool.ownerId !== undefined}
          class:owned={pool.ownerId !== undefined &&
            pool.ownerId === accountId}
          class:no-deposit={pool.ownerId !== undefined &&
            pool.ownerId !== accountId &&
            accountId !== null}
        >
          <div class="pool-header">
            <div class="pool-header-top">
              <div class="token-icons">
                {#each pool.tokens as token, i}
                  <div
                    class="token-icon-wrapper"
                    class:token-icon-second={i === 1}
                  >
                    {#if token?.metadata.icon}
                      <img
                        src={token.metadata.icon}
                        alt={token.metadata.symbol}
                        class="token-icon"
                      />
                    {:else}
                      <div class="token-icon-placeholder">
                        {token?.metadata.symbol?.charAt(0) ?? "?"}
                      </div>
                    {/if}
                    {#if token}
                      <TokenBadge {token} />
                    {/if}
                  </div>
                {/each}
              </div>
              <div class="pool-badges">
                {#if pool.ownerId !== undefined}
                  <span class="private-badge">Private</span>
                {/if}
                {#if pool.ownerId !== undefined &&
                  pool.ownerId === accountId &&
                  accountId !== null}
                  <span class="your-badge">Your</span>
                {/if}
              </div>
            </div>
            <div class="pair-symbols">
              {pool.tokens.map((t) => t?.metadata.symbol).join("-")}
            </div>
          </div>

          <div class="pool-stats">
            <div class="stat">
              <span class="stat-label">Liquidity</span>
              <span class="stat-value"
                >{formatLiquidity(calculateLiquidityUsd(pool.assets, pool.tokens))}</span
              >
            </div>
            <div class="stat">
              <span class="stat-label">Fee</span>
              <span class="stat-value">
                {(() => {
                  let str = pool.totalFeePercent.toFixed(4);
                  if (str.endsWith("00")) {
                    str = str.slice(0, -2);
                  } else if (str.endsWith("0")) {
                    str = str.slice(0, -1);
                  }
                  return str;
                })()}%
              </span>
            </div>
            <div class="stat">
              <span class="stat-label">APY</span>
              <span class="stat-value">Unknown</span>
            </div>
          </div>

          <div class="pool-footer">
            <span class="pool-id">Pool #{pool.id}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<CreatePoolModal
  isOpen={showCreatePoolModal}
  onClose={() => (showCreatePoolModal = false)}
  onSuccess={(poolId) => goto(`/pool?id=PLACH-${poolId}`)}
/>

<style>
  .liquidity-page {
    width: 100%;
    max-width: 1400px;
    padding: 0 1rem;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
    gap: 1rem;
  }

  .page-header h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .create-pool-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.52rem 1rem;
    background: var(--accent-primary);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .create-pool-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .create-pool-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .create-pool-btn svg {
    flex-shrink: 0;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .refresh-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .refresh-btn svg.spinning {
    animation: spin 1s linear infinite;
  }

  .pools-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 1rem;
  }

  /* Responsive grid */
  @media (max-width: 1400px) {
    .pools-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  @media (max-width: 1024px) {
    .pools-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (max-width: 768px) {
    .pools-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 460px) {
    .pools-grid {
      grid-template-columns: 1fr;
    }

    .page-header h2 {
      font-size: 1.25rem;
    }
  }

  @media (max-width: 400px) {
    .create-pool-btn span {
      display: none;
    }
  }

  @media (max-width: 600px) {
    .liquidity-page {
      padding: 0 0.125rem;
    }
  }

  .pool-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1rem;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    transition: all 0.2s ease;
    text-decoration: none;
    color: inherit;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }

  .pool-card:hover {
    border-color: var(--accent-primary);
    box-shadow: 0 8px 20px rgba(59, 130, 246, 0.2);
    background: var(--bg-secondary);
  }

  .pool-card:active {
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
  }

  .pool-card.no-deposit {
    border-color: #ef4444;
    box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.45);
  }

  .pool-card.no-deposit:hover {
    border-color: #dc2626;
    box-shadow:
      inset 0 0 0 1px rgba(239, 68, 68, 0.55),
      0 8px 20px rgba(239, 68, 68, 0.25);
  }

  .pool-card.no-deposit:active {
    box-shadow:
      inset 0 0 0 1px rgba(239, 68, 68, 0.55),
      0 4px 12px rgba(239, 68, 68, 0.2);
  }

  .pool-card.owned {
    border-color: #22c55e;
    box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.45);
  }

  .pool-card.owned:hover {
    border-color: #16a34a;
    box-shadow:
      inset 0 0 0 1px rgba(34, 197, 94, 0.55),
      0 8px 20px rgba(34, 197, 94, 0.25);
  }

  .pool-card.owned:active {
    box-shadow:
      inset 0 0 0 1px rgba(34, 197, 94, 0.55),
      0 4px 12px rgba(34, 197, 94, 0.2);
  }

  .pool-header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .pool-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .token-icons {
    display: flex;
    align-items: center;
  }

  .token-icon-wrapper {
    position: relative;
    width: 3rem;
    height: 3rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .token-icon {
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid var(--bg-card);
    background: var(--bg-secondary);
  }

  .token-icon-second {
    margin-left: -1rem;
  }

  .token-icon-wrapper:not(.token-icon-second) .token-icon,
  .token-icon-wrapper:not(.token-icon-second) .token-icon-placeholder {
    filter: brightness(0.95);
  }

  .token-icons :global(.reputation-reputable),
  .token-icons :global(.reputation-notfake) {
    display: none;
  }

  .token-icon-placeholder {
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent-primary), #2563eb);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 1rem;
    color: white;
    border: 3px solid var(--bg-card);
  }

  .pair-symbols {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
    font-family: "JetBrains Mono", monospace;
    word-break: break-all;
  }

  .pool-badges {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
  }

  .private-badge {
    font-size: 0.625rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
    border-radius: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }

  .your-badge {
    font-size: 0.625rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
    border-radius: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }

  .pool-stats {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .stat {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .stat-label {
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .stat-value {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    font-family: "JetBrains Mono", monospace;
  }

  .pool-footer {
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-color);
    display: flex;
    justify-content: center;
  }

  .pool-id {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .loading,
  .error,
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 1rem;
    gap: 1rem;
  }

  .loading p,
  .error p,
  .empty p {
    margin: 0;
    color: var(--text-secondary);
  }

  .error button {
    padding: 0.5rem 1rem;
    background: var(--accent-primary);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .error button:hover {
    background: var(--accent-hover);
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
