<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { tokenHubStore } from "../../lib/tokenHubStore";
  import { walletStore } from "../../lib/walletStore";
  import {
    DEX_BACKEND_API,
    formatAmount,
    formatApy,
    formatFeePercent,
    formatLiquidity,
  } from "../../lib/utils";
  import {
    type TokenInfo,
    type AssetWithBalance,
    type XykPool,
    normalizePool,
  } from "../../lib/types";
  import {
    calculatePoolFeesApyPercent,
    getPoolFeeFractionDecimal,
  } from "../../lib/pool/shared";
  import CreatePoolModal from "../../lib/CreatePoolModal.svelte";
  import Spinner from "../../lib/Spinner.svelte";
  import TokenIcon from "../../lib/TokenIcon.svelte";

  interface PoolDisplay {
    id: number;
    ownerId: string | null;
    locked: boolean;
    assets: [AssetWithBalance, AssetWithBalance];
    totalFeePercent: number;
    tokens: [TokenInfo | null, TokenInfo | null];
    ownedLiquidityUsd?: number;
    volume24hUsd: number;
    volume7dUsd: number;
    poolFeeFractionDecimal: number;
  }

  interface PoolWithOwnedLiquidity extends XykPool {
    owned_liquidity_usd?: string;
  }

  let pools = $state<PoolDisplay[]>([]);
  let isFetchingPools = $state(false);
  let isLoadingTokens = $state(false);
  let canDisplayPools = $state(false);
  const isLoading = $derived(
    isFetchingPools || (isLoadingTokens && !canDisplayPools),
  );
  let error = $state<string | null>(null);
  let tokenDisplayFallbackTimer: number | null = null;
  let showCreatePoolModal = $state(false);

  const accountId = $derived($walletStore.accountId);
  let isConnecting = $state(false);
  let fetchId = 0;

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
    return poolList.map((pool) => ({
      ...pool,
      tokens: [
        tokenHubStore.selectToken(pool.assets[0].asset_id),
        tokenHubStore.selectToken(pool.assets[1].asset_id),
      ] as [TokenInfo | null, TokenInfo | null],
    }));
  }

  function clearTokenDisplayFallbackTimer() {
    if (tokenDisplayFallbackTimer) {
      clearTimeout(tokenDisplayFallbackTimer);
      tokenDisplayFallbackTimer = null;
    }
  }

  function startTokenDisplayFallbackTimer(
    poolList: PoolDisplay[],
    requestId: number,
  ) {
    clearTokenDisplayFallbackTimer();
    tokenDisplayFallbackTimer = setTimeout(() => {
      if (isLoadingTokens && requestId === fetchId) {
        pools = buildPoolsWithCachedTokens(poolList);
        canDisplayPools = true;
      }
    }, 1000);
  }

  function calculateLiquidityUsd(
    assets: [AssetWithBalance, AssetWithBalance],
    tokens: [TokenInfo | null, TokenInfo | null],
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

  async function fetchPools() {
    const id = ++fetchId;
    isFetchingPools = true;
    isLoadingTokens = false;
    canDisplayPools = false;
    error = null;

    try {
      const url = accountId
        ? `${DEX_BACKEND_API}/pools/all?accountId=${accountId}`
        : `${DEX_BACKEND_API}/pools/all`;
      const response = await fetch(url);
      if (id !== fetchId) return;

      if (!response.ok) {
        throw new Error("Failed to fetch pools");
      }

      const data: PoolWithOwnedLiquidity[] = await response.json();
      if (id !== fetchId) return;

      const processedPools: PoolDisplay[] = [];

      for (const pool of data) {
        const normalizedPool = normalizePool(pool.pool);
        const fees = normalizedPool.fees;
        const totalFeePercent =
          fees.receivers
            .filter(([receiver]) => {
              // Exclude protocol fee from displayed fee
              if (typeof receiver === "object" && "Account" in receiver) {
                return receiver.Account !== "plach.intear.near";
              }
              return true;
            })
            .reduce((acc, [, amount]) => acc + amount, 0) / 10000;
        const poolFeeFractionDecimal = getPoolFeeFractionDecimal(fees);

        const ownedUsd =
          pool.owned_liquidity_usd !== undefined
            ? parseFloat(pool.owned_liquidity_usd)
            : undefined;

        processedPools.push({
          id: pool.id,
          ownerId: normalizedPool.ownerId,
          locked: normalizedPool.locked,
          assets: normalizedPool.assets,
          totalFeePercent,
          tokens: [null, null],
          ownedLiquidityUsd: Number.isFinite(ownedUsd) ? ownedUsd : undefined,
          volume24hUsd: pool.volume_24h_usd,
          volume7dUsd: pool.volume_7d_usd,
          poolFeeFractionDecimal,
        });
      }

      if (id !== fetchId) return;
      pools = processedPools;
      isFetchingPools = false;

      if (processedPools.length === 0) {
        canDisplayPools = true;
        return;
      }

      isLoadingTokens = true;
      startTokenDisplayFallbackTimer(processedPools, id);
      await loadAllPoolTokens(processedPools, id);
      if (id !== fetchId) return;
      isLoadingTokens = false;
      canDisplayPools = true;
      clearTokenDisplayFallbackTimer();
    } catch (e) {
      if (id !== fetchId) return;
      error = "Error getting pools, try again";
      console.error("Error fetching pools:", e);
      canDisplayPools = true;
      isLoadingTokens = false;
      clearTokenDisplayFallbackTimer();
    } finally {
      if (id === fetchId) {
        isFetchingPools = false;
      }
    }
  }

  async function loadAllPoolTokens(poolList: PoolDisplay[], requestId: number) {
    const uniqueAssetIds = Array.from(
      new Set(poolList.flatMap((pool) => pool.assets.map((a) => a.asset_id))),
    );

    await tokenHubStore.refreshTokens();
    if (requestId !== fetchId) return;
    await Promise.allSettled(
      uniqueAssetIds.map((assetId) =>
        tokenHubStore.ensureTokenByAssetId(assetId),
      ),
    );
    if (requestId !== fetchId) return;

    pools = buildPoolsWithCachedTokens(poolList);
  }

  $effect(() => {
    void accountId;
    fetchPools();
  });

  onMount(() => {
    tokenHubStore.updatePricesEvery(10_000);
    tokenHubStore.updateBalancesEvery(null);
  });

  onDestroy(() => {
    clearTokenDisplayFallbackTimer();
    tokenHubStore.updateBalancesEvery(null);
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
      <Spinner size={32} borderWidth={3} />
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
        {@const liquidityUsd = calculateLiquidityUsd(pool.assets, pool.tokens)}
        {@const apyPercent = calculatePoolFeesApyPercent(
          pool.volume24hUsd,
          pool.poolFeeFractionDecimal,
          liquidityUsd,
        )}
        <a
          href="/pool?id=PLACH-{pool.id}"
          class="pool-card"
          class:private={pool.ownerId !== null}
          class:owned={pool.ownerId !== null && pool.ownerId === accountId}
          class:no-deposit={pool.ownerId !== null &&
            pool.ownerId !== accountId &&
            accountId !== null}
        >
          <div class="pool-header">
            <div class="pool-header-top">
              <div class="token-icons">
                {#each pool.tokens as token, i}
                  <TokenIcon
                    {token}
                    size={48}
                    showBadge
                    preferMetadataIcon
                    overlap={i === 1}
                    ring={i !== 1}
                    ringWidth={3}
                  />
                {/each}
              </div>
              <div class="pool-badges">
                {#if pool.ownerId !== null}
                  <span class="private-badge">Private</span>
                {/if}
                {#if pool.ownerId !== null && pool.ownerId === accountId && accountId !== null}
                  <span class="your-badge">Yours</span>
                {/if}
                {#if pool.locked}
                  <span class="burnt-badge">Burnt</span>
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
              <span class="stat-value">{formatLiquidity(liquidityUsd)}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Fee</span>
              <span class="stat-value"
                >{formatFeePercent(pool.totalFeePercent)}%</span
              >
            </div>
            <div class="stat">
              <span class="stat-label">APY</span>
              <span class="stat-value">{formatApy(apyPercent)}</span>
            </div>
            <div class="stat">
              <span class="stat-label">7d Volume</span>
              <span class="stat-value">{formatLiquidity(pool.volume7dUsd)}</span
              >
            </div>
          </div>

          <div class="pool-footer">
            <span class="pool-id">Pool #{pool.id}</span>
            {#if pool.ownedLiquidityUsd !== undefined}
              <span class="your-liquidity-value">
                {"$" + formatAmount(pool.ownedLiquidityUsd)}
              </span>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<CreatePoolModal
  isOpen={showCreatePoolModal}
  onClose={() => (showCreatePoolModal = false)}
  onSuccess={(poolId) => goto(`/pool?id=PLACH-${poolId}&fromCreate=1`)}
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
    background: var(--accent-button-small);
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

  .token-icons :global(.reputation-reputable),
  .token-icons :global(.reputation-notfake) {
    display: none;
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

  .burnt-badge {
    font-size: 0.625rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
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

  .your-liquidity-value {
    padding: 0.25rem 0.625rem;
    background: linear-gradient(135deg, var(--accent-primary), #2563eb);
    color: white;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .pool-footer {
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
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
    background: var(--accent-button-small);
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
</style>
