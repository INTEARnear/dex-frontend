<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Spinner from "../../lib/Spinner.svelte";
  import ExpandableEntityStatsList from "../../lib/stats/ExpandableEntityStatsList.svelte";
  import HistogramChart from "../../lib/stats/HistogramChart.svelte";
  import {
    fetchAssetSeries,
    fetchPoolSeries,
    fetchTotalSeries,
    fetchTvlAssetItems,
    fetchTvlPoolItems,
    fetchVolumeAssetItems,
    fetchVolumePoolItems,
  } from "../../lib/stats/api";
  import {
    buildStatsSearchParams,
    parseStatsQuery,
    withAssetSelection,
    withPoolSelection,
    withTab,
    withTimeframe,
    withTotalSelection,
  } from "../../lib/stats/queryState";
  import type {
    StatsAssetReadyData,
    StatsAssetListItem,
    StatsPoolListItem,
    StatsPoolReadyData,
    StatsReadyData,
    StatsRouteState,
    StatsRuntimeState,
    StatsTab,
    StatsTimeframe,
  } from "../../lib/stats/types";

  const TABS: StatsTab[] = ["Volume", "Tvl"];
  const TIMEFRAMES: StatsTimeframe[] = ["Day", "Week", "Month"];

  const parsedQuery = $derived(parseStatsQuery(page.url.searchParams));
  const routeState = $derived(parsedQuery.state);
  const initialRouteState = parseStatsQuery(page.url.searchParams).state;

  let pageState = $state<StatsRuntimeState>({
    status: "loading",
    route: initialRouteState,
  });
  let requestGeneration = 0;
  let reloadNonce = $state(0);
  let poolListSnapshot = $state<{ tab: StatsTab; items: StatsPoolListItem[] } | null>(
    null,
  );
  let assetListSnapshot = $state<{
    tab: StatsTab;
    items: StatsAssetListItem[];
  } | null>(null);

  function metricLabel(tab: StatsTab): string {
    return tab === "Volume" ? "Volume" : "TVL";
  }

  function poolListTitle(tab: StatsTab): string {
    return tab === "Volume" ? "Pools Volume" : "Pools TVL";
  }

  function assetListTitle(tab: StatsTab): string {
    return tab === "Volume" ? "Tokens Volume" : "Tokens TVL";
  }

  function setRouteState(nextState: StatsRouteState) {
    const nextUrl = new URL(page.url);
    nextUrl.search = buildStatsSearchParams(nextState).toString();
    void goto(nextUrl, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
      invalidateAll: false,
    });
  }

  function reload() {
    reloadNonce += 1;
  }

  function defaultPoolIdFromCurrentState(): number {
    if (pageState.status !== "ready") return 0;
    if (pageState.data.kind !== "pool") return 0;
    return pageState.data.items[0]?.poolId ?? 0;
  }

  function defaultAssetIdFromCurrentState(): string {
    if (pageState.status !== "ready") return "near";
    if (pageState.data.kind !== "asset") return "near";
    return pageState.data.items[0]?.assetId ?? "near";
  }

  function handleTabChange(tab: StatsTab) {
    setRouteState(withTab(routeState, tab));
  }

  function handleTotalScopeClick() {
    setRouteState(withTotalSelection(routeState));
  }

  function handlePoolScopeClick() {
    if (routeState.selection.kind === "pool") return;
    setRouteState(withPoolSelection(routeState, defaultPoolIdFromCurrentState()));
  }

  function handleAssetScopeClick() {
    if (routeState.selection.kind === "asset") return;
    setRouteState(withAssetSelection(routeState, defaultAssetIdFromCurrentState()));
  }

  function handleTimeframeChange(timeframe: StatsTimeframe) {
    setRouteState(withTimeframe(routeState, timeframe));
  }

  function handlePoolSelect(poolIdRaw: string) {
    if (!/^\d+$/.test(poolIdRaw)) return;
    const poolId = Number.parseInt(poolIdRaw, 10);
    if (!Number.isFinite(poolId) || poolId < 0) return;
    setRouteState(withPoolSelection(routeState, poolId));
  }

  function handleAssetSelect(assetId: string) {
    if (!assetId) return;
    setRouteState(withAssetSelection(routeState, assetId));
  }

  async function loadDataForRoute(state: StatsRouteState): Promise<StatsReadyData> {
    if (state.selection.kind === "total") {
      const series = await fetchTotalSeries(state.tab, state.timeframe);
      return {
        kind: "total",
        series,
      };
    }

    if (state.selection.kind === "pool") {
      const [items, series] = await Promise.all([
        state.tab === "Volume"
          ? fetchVolumePoolItems(state.timeframe)
          : fetchTvlPoolItems(),
        fetchPoolSeries(state.tab, state.selection.poolId, state.timeframe),
      ]);

      return {
        kind: "pool",
        items,
        selectedPoolId: state.selection.poolId,
        series,
      } satisfies StatsPoolReadyData;
    }

    const [items, series] = await Promise.all([
      state.tab === "Volume"
        ? fetchVolumeAssetItems(state.timeframe)
        : fetchTvlAssetItems(),
      fetchAssetSeries(state.tab, state.selection.assetId, state.timeframe),
    ]);

    return {
      kind: "asset",
      items,
      selectedAssetId: state.selection.assetId,
      series,
    } satisfies StatsAssetReadyData;
  }

  $effect(() => {
    const parsed = parsedQuery;
    if (parsed.isCanonical) return;

    const nextUrl = new URL(page.url);
    nextUrl.search = parsed.canonicalSearchParams.toString();
    void goto(nextUrl, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
      invalidateAll: false,
    });
  });

  $effect(() => {
    const parsed = parsedQuery;
    const _reloadNonce = reloadNonce;
    void _reloadNonce;
    if (!parsed.isCanonical) return;

    const route = parsed.state;
    const generation = ++requestGeneration;
    pageState = {
      status: "loading",
      route,
    };

    void loadDataForRoute(route)
      .then((data) => {
        if (generation !== requestGeneration) return;
        pageState = {
          status: "ready",
          route,
          data,
        };
      })
      .catch((error) => {
        if (generation !== requestGeneration) return;
        pageState = {
          status: "error",
          route,
          message: error instanceof Error ? error.message : "Unknown error",
        };
      });
  });

  $effect(() => {
    const readyState = pageState;
    if (readyState.status !== "ready") return;

    if (readyState.data.kind === "pool") {
      poolListSnapshot = {
        tab: readyState.route.tab,
        items: readyState.data.items,
      };
    } else if (readyState.data.kind === "asset") {
      assetListSnapshot = {
        tab: readyState.route.tab,
        items: readyState.data.items,
      };
    }

    if (readyState.data.kind === "pool") {
      const selectedPoolId = readyState.data.selectedPoolId;
      const poolItems = readyState.data.items;
      const exists = poolItems.some((item) => item.poolId === selectedPoolId);
      if (!exists && poolItems.length > 0) {
        setRouteState(withPoolSelection(readyState.route, poolItems[0].poolId));
      }
      return;
    }

    if (readyState.data.kind === "asset") {
      const selectedAssetId = readyState.data.selectedAssetId;
      const assetItems = readyState.data.items;
      const exists = assetItems.some((item) => item.assetId === selectedAssetId);
      if (!exists && assetItems.length > 0) {
        setRouteState(withAssetSelection(readyState.route, assetItems[0].assetId));
      }
    }
  });
</script>

<div class="stats-page">
  <div class="stats-header">
    <h2>DEX Statistics</h2>
    <div class="tab-strip" role="tablist" aria-label="Stats tab">
      {#each TABS as tab (tab)}
        <button
          type="button"
          class="tab-btn"
          class:active={routeState.tab === tab}
          onclick={() => handleTabChange(tab)}
        >
          {tab}
        </button>
      {/each}
    </div>
  </div>

  <div class="scope-strip" role="tablist" aria-label="Stats scope">
    <button
      type="button"
      class="scope-btn"
      class:active={routeState.selection.kind === "total"}
      onclick={handleTotalScopeClick}
    >
      Total
    </button>
    <button
      type="button"
      class="scope-btn"
      class:active={routeState.selection.kind === "pool"}
      onclick={handlePoolScopeClick}
    >
      Pools
    </button>
    <button
      type="button"
      class="scope-btn"
      class:active={routeState.selection.kind === "asset"}
      onclick={handleAssetScopeClick}
    >
      Tokens
    </button>
  </div>

  {#if pageState.status === "loading"}
    {#if routeState.selection.kind === "pool" &&
      poolListSnapshot &&
      poolListSnapshot.tab === routeState.tab}
      <ExpandableEntityStatsList
        title={poolListTitle(routeState.tab)}
        items={poolListSnapshot.items}
        selectedKey={String(routeState.selection.poolId)}
        timeframe={routeState.timeframe}
        metricLabel={metricLabel(routeState.tab)}
        detailSeries={[]}
        detailLoading={true}
        detailError={null}
        onSelect={handlePoolSelect}
        onTimeframeChange={handleTimeframeChange}
      />
    {:else if routeState.selection.kind === "asset" &&
      assetListSnapshot &&
      assetListSnapshot.tab === routeState.tab}
      <ExpandableEntityStatsList
        title={assetListTitle(routeState.tab)}
        items={assetListSnapshot.items}
        selectedKey={routeState.selection.assetId}
        timeframe={routeState.timeframe}
        metricLabel={metricLabel(routeState.tab)}
        detailSeries={[]}
        detailLoading={true}
        detailError={null}
        onSelect={handleAssetSelect}
        onTimeframeChange={handleTimeframeChange}
      />
    {:else}
      <div class="state-panel loading">
        <Spinner size={28} borderWidth={3} />
        <span>Loading statistics...</span>
      </div>
    {/if}
  {:else if pageState.status === "error"}
    {#if pageState.route.selection.kind === "pool" &&
      poolListSnapshot &&
      poolListSnapshot.tab === pageState.route.tab}
      <ExpandableEntityStatsList
        title={poolListTitle(pageState.route.tab)}
        items={poolListSnapshot.items}
        selectedKey={String(pageState.route.selection.poolId)}
        timeframe={pageState.route.timeframe}
        metricLabel={metricLabel(pageState.route.tab)}
        detailSeries={[]}
        detailLoading={false}
        detailError={pageState.message}
        onSelect={handlePoolSelect}
        onTimeframeChange={handleTimeframeChange}
      />
    {:else if pageState.route.selection.kind === "asset" &&
      assetListSnapshot &&
      assetListSnapshot.tab === pageState.route.tab}
      <ExpandableEntityStatsList
        title={assetListTitle(pageState.route.tab)}
        items={assetListSnapshot.items}
        selectedKey={pageState.route.selection.assetId}
        timeframe={pageState.route.timeframe}
        metricLabel={metricLabel(pageState.route.tab)}
        detailSeries={[]}
        detailLoading={false}
        detailError={pageState.message}
        onSelect={handleAssetSelect}
        onTimeframeChange={handleTimeframeChange}
      />
    {:else}
      <div class="state-panel error">
        <p>{pageState.message}</p>
        <button type="button" class="retry-btn" onclick={reload}>Retry</button>
      </div>
    {/if}
  {:else if pageState.data.kind === "total"}
    <section class="total-card">
      <div class="total-card-top">
        <h3>{metricLabel(pageState.route.tab)} Total</h3>
        <div class="timeframe-tabs" role="tablist" aria-label="Timeframe">
          {#each TIMEFRAMES as timeframe (timeframe)}
            <button
              type="button"
              class="timeframe-btn"
              class:active={routeState.timeframe === timeframe}
              onclick={() => handleTimeframeChange(timeframe)}
            >
              {timeframe}
            </button>
          {/each}
        </div>
      </div>
      <HistogramChart
        points={pageState.data.series}
        metricLabel={metricLabel(pageState.route.tab)}
      />
    </section>
  {:else if pageState.data.kind === "pool"}
    <ExpandableEntityStatsList
      title={poolListTitle(pageState.route.tab)}
      items={pageState.data.items}
      selectedKey={String(pageState.data.selectedPoolId)}
      timeframe={routeState.timeframe}
      metricLabel={metricLabel(pageState.route.tab)}
      detailSeries={pageState.data.series}
      detailLoading={false}
      detailError={null}
      onSelect={handlePoolSelect}
      onTimeframeChange={handleTimeframeChange}
    />
  {:else}
    <ExpandableEntityStatsList
      title={assetListTitle(pageState.route.tab)}
      items={pageState.data.items}
      selectedKey={pageState.data.selectedAssetId}
      timeframe={routeState.timeframe}
      metricLabel={metricLabel(pageState.route.tab)}
      detailSeries={pageState.data.series}
      detailLoading={false}
      detailError={null}
      onSelect={handleAssetSelect}
      onTimeframeChange={handleTimeframeChange}
    />
  {/if}
</div>

<style>
  .stats-page {
    width: 100%;
    max-width: 1400px;
    padding: 0 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .stats-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .stats-header h2 {
    margin: 0;
    font-size: 1.5rem;
    color: var(--text-primary);
  }

  .tab-strip,
  .scope-strip,
  .timeframe-tabs {
    display: flex;
    gap: 0.25rem;
    background: var(--bg-input);
    padding: 0.25rem;
    border-radius: 0.625rem;
    width: fit-content;
  }

  .scope-strip {
    width: 100%;
  }

  .tab-btn,
  .scope-btn,
  .timeframe-btn {
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0.45rem 0.75rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .scope-btn {
    flex: 1;
  }

  .tab-btn.active,
  .scope-btn.active,
  .timeframe-btn.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .state-panel {
    width: 100%;
    min-height: 220px;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1.5rem;
    color: var(--text-secondary);
  }

  .state-panel.error p {
    margin: 0;
    color: #f87171;
    text-align: center;
  }

  .retry-btn {
    border: none;
    border-radius: 0.5rem;
    background: var(--accent-button-small);
    color: white;
    font-weight: 600;
    padding: 0.45rem 0.8rem;
    cursor: pointer;
  }

  .retry-btn:hover {
    background: var(--accent-hover);
  }

  .total-card {
    width: 100%;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .total-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .total-card-top h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 1.05rem;
  }

  @media (--tablet) {
    .stats-page {
      padding: 0;
    }
  }

  @media (--mobile) {
    .stats-header h2 {
      font-size: 1.25rem;
    }

    .tab-btn,
    .scope-btn,
    .timeframe-btn {
      font-size: 0.8rem;
      padding: 0.4rem 0.55rem;
    }

    .total-card {
      padding: 0.8rem;
    }
  }
</style>
