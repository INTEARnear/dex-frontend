<script lang="ts">
  import { flip } from "svelte/animate";
  import { cubicOut } from "svelte/easing";
  import { slide } from "svelte/transition";
  import { ChevronRight } from "lucide-svelte";
  import Spinner from "../Spinner.svelte";
  import TokenIcon from "../TokenIcon.svelte";
  import { formatLiquidity } from "../utils";
  import HistogramChart from "./HistogramChart.svelte";
  import type {
    StatsAssetListItem,
    StatsPoolListItem,
    StatsSeriesPoint,
    StatsTimeframe,
  } from "./types";

  type EntityItem = StatsPoolListItem | StatsAssetListItem;

  interface Props {
    title: string;
    items: EntityItem[];
    selectedKey: string | null;
    timeframe: StatsTimeframe;
    metricLabel: string;
    chartSummaryMode: "sum" | "latest";
    detailSeries: StatsSeriesPoint[];
    detailLoading: boolean;
    detailError: string | null;
    onSelect: (key: string) => void;
    onTimeframeChange: (timeframe: StatsTimeframe) => void;
  }

  const TIMEFRAMES: StatsTimeframe[] = ["Day", "Week", "Month"];

  let {
    title,
    items,
    selectedKey,
    timeframe,
    metricLabel,
    chartSummaryMode,
    detailSeries,
    detailLoading,
    detailError,
    onSelect,
    onTimeframeChange,
  }: Props = $props();

  function getItemKey(item: EntityItem): string {
    return item.kind === "pool" ? String(item.poolId) : item.assetId;
  }

  function isExpanded(item: EntityItem): boolean {
    return getItemKey(item) === selectedKey;
  }
</script>

<section class="entity-card">
  <div class="entity-header">
    <h3>{title}</h3>
  </div>

  {#if items.length === 0}
    <div class="empty">No entries found</div>
  {:else}
    <div class="entity-list">
      {#each items as item, index (`${item.kind}:${getItemKey(item)}`)}
        {@const expanded = isExpanded(item)}
        <article
          class="entity-row"
          class:expanded={expanded}
          class:odd={index % 2 === 1}
          animate:flip={{ duration: 220, easing: cubicOut }}
        >
          <button
            type="button"
            class="entity-main"
            onclick={() => onSelect(getItemKey(item))}
            aria-expanded={expanded}
          >
            <span class="entity-icons">
              {#if item.kind === "pool"}
                {#each item.tokens as token, tokenIndex (tokenIndex)}
                  <TokenIcon
                    {token}
                    size={30}
                    overlap={tokenIndex === 1}
                    ring={tokenIndex !== 1}
                    ringWidth={2}
                  />
                {/each}
              {:else}
                <TokenIcon token={item.token} size={30} ring ringWidth={2} />
              {/if}
            </span>
            <span class="entity-labels">
              <span class="primary">{item.primaryLabel}</span>
              <span class="secondary">{item.secondaryLabel}</span>
            </span>
            <span class="entity-metric">{formatLiquidity(item.valueUsd)}</span>
            <span class="expand-indicator" class:rotated={expanded} aria-hidden="true">
              <ChevronRight size="1em" strokeWidth={2.25} />
            </span>
          </button>

          {#if expanded}
            <div class="expanded-content" transition:slide={{ duration: 200, easing: cubicOut }}>
              <div class="expanded-top">
                <span class="expanded-title">History</span>
                <div class="timeframe-tabs" role="tablist" aria-label="Timeframe">
                  {#each TIMEFRAMES as option (option)}
                    <button
                      type="button"
                      class="timeframe-btn"
                      class:active={timeframe === option}
                      onclick={() => onTimeframeChange(option)}
                    >
                      {option}
                    </button>
                  {/each}
                </div>
              </div>

              {#if detailLoading}
                <div class="detail-loading">
                  <Spinner size={20} borderWidth={2} />
                  <span>Loading chart...</span>
                </div>
              {:else if detailError}
                <div class="detail-error">{detailError}</div>
              {:else}
                <HistogramChart
                  points={detailSeries}
                  metricLabel={metricLabel}
                  summaryMode={chartSummaryMode}
                />
              {/if}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .entity-card {
    width: 100%;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .entity-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-primary);
  }

  .entity-list {
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    overflow: hidden;
  }

  .entity-row {
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease;
  }

  .entity-row:last-child {
    border-bottom: none;
  }

  .entity-row.odd .entity-main {
    background: rgba(255, 255, 255, 0.01);
  }

  .entity-row.expanded .entity-main {
    background: var(--bg-input);
  }

  .entity-main {
    width: 100%;
    background: transparent;
    border: none;
    color: inherit;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    text-align: left;
    padding: 0.75rem 0.875rem;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }

  .entity-main:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .entity-labels {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .entity-icons {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    min-width: 30px;
  }

  .primary {
    color: var(--text-primary);
    font-size: 0.9rem;
    font-weight: 600;
    line-height: 1.2;
  }

  .secondary {
    color: var(--text-muted);
    font-size: 0.78rem;
    line-height: 1.25;
    word-break: break-all;
  }

  .entity-metric {
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
    white-space: nowrap;
  }

  .expand-indicator {
    color: var(--text-muted);
    font-size: 1.3rem;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      transform 0.2s ease,
      color 0.2s ease;
  }

  .expand-indicator.rotated {
    transform: rotate(90deg);
    color: var(--text-secondary);
  }

  .expanded-content {
    padding: 0.75rem 0.875rem 0.875rem;
    border-top: 1px solid var(--border-color);
    background: var(--bg-input);
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    overflow: hidden;
  }

  .expanded-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .expanded-title {
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .timeframe-tabs {
    display: flex;
    gap: 0.25rem;
    background: var(--bg-secondary);
    padding: 0.2rem;
    border-radius: 0.5rem;
  }

  .timeframe-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 0.375rem;
    padding: 0.35rem 0.55rem;
    cursor: pointer;
  }

  .timeframe-btn.active {
    color: var(--text-primary);
    background: var(--bg-card);
  }

  .detail-loading,
  .detail-error,
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
    padding: 1rem 0.75rem;
    border: 1px dashed var(--border-color);
    border-radius: 0.625rem;
  }

  .detail-loading,
  .detail-error {
    min-height: 396.35px;
  }

  .detail-error {
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.35);
  }

  @media (--mobile) {
    .entity-card {
      padding: 0.8rem;
    }

    .entity-main {
      padding: 0.65rem 0.7rem;
      gap: 0.5rem;
    }

    .entity-metric {
      font-size: 0.8rem;
    }

    .timeframe-btn {
      font-size: 0.72rem;
      padding: 0.3rem 0.45rem;
    }

    .detail-loading,
    .detail-error {
      min-height: 242px;
    }
  }
</style>
