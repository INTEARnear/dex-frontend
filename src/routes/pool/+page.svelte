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
  import { tokenHubStore } from "../../lib/tokenHubStore";
  import { walletStore } from "../../lib/walletStore";
  import type {
    AssetWithBalance,
    TokenInfo,
    XykFeeReceiver,
  } from "../../lib/types";
  import {
    DEX_BACKEND_API,
    type NormalizedPool,
    parsePoolId,
  } from "../../lib/pool/shared";
  import Spinner from "../../lib/Spinner.svelte";

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

  let activePoolRequestId = 0;

  type LiquidityTab = "add" | "remove";

  let poolData = $state<NormalizedPool | null>(null);
  let token0 = $state<TokenInfo | null>(null);
  let token1 = $state<TokenInfo | null>(null);
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

  async function fetchTokenInfo(assetId: string): Promise<TokenInfo | null> {
    return tokenHubStore.ensureTokenByAssetId(assetId);
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

  function handleLiquidityTabKeydown(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    activeTab = activeTab === "add" ? "remove" : "add";
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

    tokenHubStore.updateBalancesEvery(1000);
    tokenHubStore.updatePricesEvery(3000);

    const interval = setInterval(() => {
      fetchPoolData(id, accountId ?? undefined, true);
    }, 1000);
    return () => {
      clearInterval(interval);
      tokenHubStore.updateBalancesEvery(null);
      tokenHubStore.updatePricesEvery(10_000);
    };
  });
</script>

<div class="pool-page">
  {#if isLoading}
    <div class="loading">
      <Spinner size={28} borderWidth={3} />
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
            <div
              class="liquidity-tabs"
              role="tablist"
              aria-label="Liquidity actions"
            >
              <button
                class="tab-btn"
                id="add-liquidity-tab"
                type="button"
                role="tab"
                class:active={activeTab === "add"}
                aria-selected={activeTab === "add"}
                aria-controls="add-liquidity-panel"
                tabindex={activeTab === "add" ? 0 : -1}
                onclick={() => (activeTab = "add")}
                onkeydown={handleLiquidityTabKeydown}
              >
                Add Liquidity
              </button>
              <button
                class="tab-btn"
                id="remove-liquidity-tab"
                type="button"
                role="tab"
                class:active={activeTab === "remove"}
                aria-selected={activeTab === "remove"}
                aria-controls="remove-liquidity-panel"
                tabindex={activeTab === "remove" ? 0 : -1}
                onclick={() => (activeTab = "remove")}
                onkeydown={handleLiquidityTabKeydown}
              >
                Remove Liquidity
              </button>
            </div>
          {:else}
            <h2>Add Liquidity</h2>
          {/if}
        </div>

        {#if activeTab === "add" || !hasUserShares || isPrivate}
          {#if hasUserShares && !isPrivate}
            <div
              id="add-liquidity-panel"
              role="tabpanel"
              aria-labelledby="add-liquidity-tab"
            >
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
            </div>
          {:else}
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
          {/if}
        {:else}
          <div
            id="remove-liquidity-panel"
            role="tabpanel"
            aria-labelledby="remove-liquidity-tab"
          >
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
          </div>
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

  #add-liquidity-panel,
  #remove-liquidity-panel {
    display: contents;
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
