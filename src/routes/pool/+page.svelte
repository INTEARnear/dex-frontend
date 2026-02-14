<script lang="ts">
  import { page } from "$app/state";
  import PoolInfo from "../../lib/pool/PoolInfo.svelte";
  import LiquidityInfo from "../../lib/pool/LiquidityInfo.svelte";
  import PositionsSection, {
    type ClosedPosition,
  } from "../../lib/pool/PositionsSection.svelte";
  import AddLiquidityTab from "../../lib/pool/AddLiquidityTab.svelte";
  import RemoveLiquidityTab from "../../lib/pool/RemoveLiquidityTab.svelte";
  import AddedLiquidityModal, {
    type AddedLiquiditySnapshot,
  } from "../../lib/pool/AddedLiquidityModal.svelte";
  import RemovedLiquidityModal, {
    type RemovedLiquiditySnapshot,
  } from "../../lib/pool/RemovedLiquidityModal.svelte";
  import type {
    LiquidityAddedEventData,
    LiquidityRemovedEventData,
  } from "../../lib/pool/liquidityEvents";
  import { walletStore } from "../../lib/walletStore";
  import { refreshBalances } from "../../lib/balanceStore";
  import { NEAR_TOKEN } from "../../lib/tokenStore";
  import type {
    AssetWithBalance,
    Token,
    XykFeeReceiver,
  } from "../../lib/types";
  import { PRICES_API } from "../../lib/utils";
  import {
    DEX_BACKEND_API,
    assetIdToTokenId,
    type NormalizedPool,
    parsePoolId,
  } from "../../lib/pool/shared";

  interface TrackedFeeConfig {
    receivers: Array<[XykFeeReceiver, number]>;
  }

  interface TrackedPrivatePool {
    assets: [AssetWithBalance, AssetWithBalance];
    fees: TrackedFeeConfig;
    owner_id: string;
  }

  interface TrackedPublicPool {
    assets: [AssetWithBalance, AssetWithBalance];
    fees: TrackedFeeConfig;
    total_shares?: string | null;
  }

  interface TrackedPool {
    Private?: TrackedPrivatePool;
    Public?: TrackedPublicPool;
  }

  interface UntrackedPosition {
    pool_id: number;
    shares: string;
  }

  interface OpenPosition {
    position_id: number;
    pool_id: number;
    shares: string;
    asset0_amount: string;
    asset1_amount: string;
    asset0_open_price_usd: number;
    asset1_open_price_usd: number;
    opened_at: string;
    transaction_hash: string;
  }

  interface TrackPositionsResponse {
    pool: TrackedPool;
    open?: OpenPosition[];
    closed?: ClosedPosition[];
    untracked?: UntrackedPosition;
  }

  const tokenRequestCache = new Map<string, Promise<Token | null>>();
  let nearPriceRequest: Promise<void> | null = null;
  let activePoolRequestId = 0;

  type LiquidityTab = "add" | "remove";

  let poolData = $state<NormalizedPool | null>(null);
  let token0 = $state<Token | null>(null);
  let token1 = $state<Token | null>(null);
  let userSharesRaw = $state<string | null>(null);
  let openPositions = $state<OpenPosition[]>([]);
  let closedPositions = $state<ClosedPosition[]>([]);
  let hasUntracked = $state(false);
  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let isConnecting = $state(false);
  let activeTab = $state<LiquidityTab>("add");

  let showAddSuccessModal = $state(false);
  let addSuccessEventData = $state<LiquidityAddedEventData | null>(null);
  let addSuccessSnapshot = $state<AddedLiquiditySnapshot | null>(null);
  let addSuccessAttached0 = $state<bigint>(0n);
  let addSuccessAttached1 = $state<bigint>(0n);

  let showRemoveSuccessModal = $state(false);
  let removeSuccessEventData = $state<LiquidityRemovedEventData | null>(null);
  let removeSuccessSnapshot = $state<RemovedLiquiditySnapshot | null>(null);

  let showCloseSuccessModal = $state(false);
  let closeSuccessEventData = $state<LiquidityRemovedEventData | null>(null);
  let closeSuccessSnapshot = $state<RemovedLiquiditySnapshot | null>(null);
  let closedPositionForModal = $state<{
    asset0_amount: string;
    asset1_amount: string;
    asset0_open_price_usd: number;
    asset1_open_price_usd: number;
  } | null>(null);

  function normalizePool(pool: TrackedPool): NormalizedPool | null {
    if (pool.Private) {
      return {
        ownerId: pool.Private.owner_id,
        assets: pool.Private.assets,
        fees: pool.Private.fees,
        totalSharesRaw: null,
      };
    }
    if (pool.Public) {
      return {
        ownerId: null,
        assets: pool.Public.assets,
        fees: pool.Public.fees,
        totalSharesRaw: pool.Public.total_shares ?? null,
      };
    }
    return null;
  }

  async function ensureNearTokenPrice(): Promise<void> {
    if (
      NEAR_TOKEN.price_usd !== "0" &&
      NEAR_TOKEN.price_usd_raw !== "0" &&
      NEAR_TOKEN.price_usd_hardcoded !== "0"
    ) {
      return;
    }

    if (nearPriceRequest) {
      await nearPriceRequest;
      return;
    }

    nearPriceRequest = (async () => {
      try {
        const response = await fetch(`${PRICES_API}/token?token_id=wrap.near`);
        if (!response.ok) return;
        const wrapNear: Token = await response.json();
        NEAR_TOKEN.price_usd = wrapNear.price_usd;
        NEAR_TOKEN.price_usd_raw = wrapNear.price_usd_raw;
        NEAR_TOKEN.price_usd_hardcoded = wrapNear.price_usd_hardcoded;
      } catch (priceError) {
        console.error("Failed to fetch wrap.near price:", priceError);
      } finally {
        nearPriceRequest = null;
      }
    })();

    await nearPriceRequest;
  }

  async function fetchTokenInfo(assetId: string): Promise<Token | null> {
    const cached = tokenRequestCache.get(assetId);
    if (cached) return cached;

    const request = (async () => {
      if (assetId === "near") {
        await ensureNearTokenPrice();
        return NEAR_TOKEN;
      }
      const tokenId = assetIdToTokenId(assetId);
      if (!tokenId) return null;

      try {
        const response = await fetch(`${PRICES_API}/token?token_id=${tokenId}`);
        if (!response.ok) return null;
        const token: Token = await response.json();
        if (!token.metadata.icon?.startsWith("data:")) {
          token.metadata.icon = undefined;
        }
        return token;
      } catch (fetchError) {
        console.error("Token fetch failed:", fetchError);
        return null;
      }
    })();

    tokenRequestCache.set(assetId, request);
    return request;
  }

  async function fetchPoolData(
    poolId: number,
    accountId?: string | null,
    background = false,
  ): Promise<void> {
    const requestId = ++activePoolRequestId;
    if (!background) {
      isLoading = true;
      error = null;
    }

    try {
      let url = `${DEX_BACKEND_API}/track/positions/${poolId}`;
      if (accountId) {
        url += `?accountId=${encodeURIComponent(accountId)}`;
      }
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Failed to fetch pool: HTTP ${response.status}`);
      const data: TrackPositionsResponse = await response.json();
      const normalized = normalizePool(data.pool);
      if (!normalized) throw new Error("Unsupported pool format");

      const [nextToken0, nextToken1] = await Promise.all([
        fetchTokenInfo(normalized.assets[0].asset_id),
        fetchTokenInfo(normalized.assets[1].asset_id),
      ]);

      if (requestId !== activePoolRequestId) return;
      poolData = normalized;
      token0 = nextToken0;
      token1 = nextToken1;
      const openSum = (data.open ?? []).reduce(
        (acc, p) => acc + BigInt(p.shares),
        0n,
      );
      const untrackedAmount = data.untracked
        ? BigInt(data.untracked.shares)
        : 0n;
      const totalShares = openSum + untrackedAmount;
      userSharesRaw = totalShares > 0n ? totalShares.toString() : null;
      openPositions = data.open ?? [];
      closedPositions = data.closed ?? [];
      hasUntracked = !!(data.untracked && BigInt(data.untracked.shares) > 0n);
    } catch (fetchError) {
      if (requestId !== activePoolRequestId) return;
      console.error("Pool fetch failed:", fetchError);
      if (!background) {
        poolData = null;
        token0 = null;
        token1 = null;
        userSharesRaw = null;
        openPositions = [];
        closedPositions = [];
        hasUntracked = false;
        error =
          fetchError instanceof Error ? fetchError.message : "Unknown error";
      }
    } finally {
      if (requestId === activePoolRequestId && !background) {
        isLoading = false;
      }
    }
  }

  async function handleConnectWallet() {
    isConnecting = true;
    try {
      await walletStore.connect();
    } catch (connectError) {
      console.error("Connection failed:", connectError);
    } finally {
      isConnecting = false;
    }
  }

  const parsedPoolId = $derived(parsePoolId(page.url.searchParams.get("id")));
  const needsRegisterLiquidity = $derived(
    poolData?.ownerId === null &&
      openPositions.length === 0 &&
      closedPositions.length === 0 &&
      !hasUntracked,
  );
  const hasUserShares = $derived(
    userSharesRaw !== null && BigInt(userSharesRaw) > 0n,
  );
  const isPrivate = $derived(poolData?.ownerId !== null);

  $effect(() => {
    const id = parsedPoolId;
    const accountId = $walletStore.accountId;
    if (id === null) {
      isLoading = false;
      error = "Invalid pool ID. Expected ?id=PLACH-<number>";
      poolData = null;
      token0 = null;
      token1 = null;
      userSharesRaw = null;
      openPositions = [];
      closedPositions = [];
      hasUntracked = false;
      return;
    }
    fetchPoolData(id, accountId);

    const interval = setInterval(() => {
      fetchPoolData(id, accountId ?? undefined, true);
      refreshBalances(accountId ?? undefined);
    }, 1000);
    return () => clearInterval(interval);
  });
</script>

<div class="pool-page">
  {#if isLoading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading pool...</p>
    </div>
  {:else if error || !poolData || parsedPoolId === null}
    <div class="error">
      <p>{error ?? "Pool not found"}</p>
      <a href="/pools" class="back-link">Back to pools</a>
    </div>
  {:else}
    <div class="pool-layout">
      <div class="sidebar-column">
        <PoolInfo
          {poolData}
          {token0}
          {token1}
          poolId={parsedPoolId}
          accountId={$walletStore.accountId}
        />
        <LiquidityInfo {poolData} {token0} {token1} {userSharesRaw} />
        <PositionsSection
          {poolData}
          {token0}
          {token1}
          open={openPositions}
          closed={closedPositions}
          poolId={parsedPoolId}
          onPositionClose={async () => {
          }}
          onCloseSuccess={(payload) => {
            closeSuccessEventData = payload.eventData;
            closeSuccessSnapshot = payload.snapshot;
            closedPositionForModal = payload.positionData;
            showCloseSuccessModal = true;
          }}
        />
      </div>

      <section class="deposit-card" class:disabled={!$walletStore.isConnected}>
        <div class="card-header">
          {#if hasUserShares && !isPrivate}
            <div class="liquidity-tabs">
              <button
                class="tab-btn"
                class:active={activeTab === "add"}
                onclick={() => (activeTab = "add")}
              >
                Add Liquidity
              </button>
              <button
                class="tab-btn"
                class:active={activeTab === "remove"}
                onclick={() => (activeTab = "remove")}
              >
                Remove Liquidity
              </button>
            </div>
          {:else}
            <h2>Add Liquidity</h2>
          {/if}
        </div>

        {#if activeTab === "add" || !hasUserShares || isPrivate}
          <AddLiquidityTab
            {poolData}
            {token0}
            {token1}
            poolId={parsedPoolId}
            {needsRegisterLiquidity}
            onSuccess={async () => {
            }}
            onAddSuccess={(payload) => {
              addSuccessEventData = payload.eventData;
              addSuccessSnapshot = payload.snapshot;
              addSuccessAttached0 = payload.attached0;
              addSuccessAttached1 = payload.attached1;
              showAddSuccessModal = true;
            }}
            {isConnecting}
            onConnectWallet={handleConnectWallet}
          />
        {:else}
          <RemoveLiquidityTab
            {poolData}
            {token0}
            {token1}
            {userSharesRaw}
            poolId={parsedPoolId}
            hasOpenPositions={openPositions.length > 0}
            onSuccess={async () => {
            }}
            onRemoveSuccess={(payload) => {
              removeSuccessEventData = payload.eventData;
              removeSuccessSnapshot = payload.snapshot;
              showRemoveSuccessModal = true;
            }}
          />
        {/if}
      </section>
    </div>
  {/if}

  <!-- Modals at page level so they persist across data refresh and tab switches -->
  <AddedLiquidityModal
    isOpen={showAddSuccessModal}
    onClose={() => {
      showAddSuccessModal = false;
      addSuccessEventData = null;
      addSuccessSnapshot = null;
    }}
    eventData={addSuccessEventData}
    snapshot={addSuccessSnapshot}
    {token0}
    {token1}
    isPrivatePool={!!poolData?.ownerId}
    attachedAmount0Raw={addSuccessAttached0}
    attachedAmount1Raw={addSuccessAttached1}
  />

  <RemovedLiquidityModal
    isOpen={showRemoveSuccessModal}
    onClose={() => {
      showRemoveSuccessModal = false;
      removeSuccessEventData = null;
      removeSuccessSnapshot = null;
    }}
    eventData={removeSuccessEventData}
    snapshot={removeSuccessSnapshot}
    {token0}
    {token1}
    isPositionClose={false}
  />

  <RemovedLiquidityModal
    isOpen={showCloseSuccessModal}
    onClose={() => {
      showCloseSuccessModal = false;
      closeSuccessEventData = null;
      closeSuccessSnapshot = null;
      closedPositionForModal = null;
    }}
    eventData={closeSuccessEventData}
    snapshot={closeSuccessSnapshot}
    {token0}
    {token1}
    isPositionClose={true}
    positionData={closedPositionForModal}
  />
</div>

<style>
  .pool-page {
    width: 100%;
    max-width: 1400px;
    padding: 0 1rem;
  }

  .pool-layout {
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(320px, 520px);
    gap: 1rem;
    justify-content: center;
    align-items: start;
  }

  .sidebar-column {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .deposit-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1.25rem;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.3),
      0 2px 4px -2px rgba(0, 0, 0, 0.2),
      0 0 0 1px rgba(59, 130, 246, 0.05);
    width: 100%;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    position: relative;
  }

  .deposit-card.disabled {
    opacity: 0.7;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .card-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
  }

  .loading,
  .error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
  }

  .loading p,
  .error p {
    margin: 0;
    color: var(--text-secondary);
  }

  .back-link {
    color: var(--accent-primary);
    text-decoration: none;
    font-weight: 600;
  }

  .back-link:hover {
    color: var(--accent-hover);
  }

  .spinner {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent-primary);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (--tablet) {
    .pool-page {
      padding: 0;
    }

    .pool-layout {
      grid-template-columns: 1fr;
      max-width: 560px;
      margin: 0 auto;
    }

    .sidebar-column {
      width: 100%;
    }

    .card-header {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  /* ── Mobile compact layout (matches SwapForm.svelte) ── */
  @media (--mobile) {
    .pool-layout {
      max-width: 100%;
    }

    .deposit-card {
      padding: 1rem;
      border-radius: 1rem;
      min-width: 0;
      gap: 0.5rem;
    }

    .tab-btn {
      padding: 0.4rem 0.5rem;
      font-size: 0.8125rem;
    }

    .liquidity-tabs {
      padding: 0.2rem;
      border-radius: 0.5rem;
    }
  }

  /* ── Very small mobile screens (< 360px) ── */
  @media (--small-mobile) {
    .deposit-card {
      padding: 0.75rem;
      gap: 0.375rem;
    }
  }

  /* Liquidity Tabs */
  .liquidity-tabs {
    display: flex;
    gap: 0.25rem;
    background: var(--bg-input);
    border-radius: 0.625rem;
    padding: 0.25rem;
    width: 100%;
  }

  .tab-btn {
    flex: 1;
    padding: 0.5rem 0.75rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab-btn:hover {
    color: var(--text-secondary);
  }

  .tab-btn.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
</style>
