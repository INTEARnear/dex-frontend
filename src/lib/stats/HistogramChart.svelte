<script lang="ts">
  import ResponsiveTooltip from "../ResponsiveTooltip.svelte";
  import { formatAmount } from "../utils";
  import type { StatsSeriesPoint } from "./types";

  interface HistogramBar {
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
    timestamp: string;
    valueUsd: number;
  }

  interface Props {
    points: StatsSeriesPoint[];
    metricLabel?: string;
    emptyMessage?: string;
  }

  interface TooltipTarget {
    index: number;
    leftPercent: number;
    widthPercent: number;
    topPercent: number;
    heightPercent: number;
    timestamp: string;
    valueUsd: number;
  }

  const CHART_WIDTH = 1000;
  const CHART_HEIGHT = 300;
  const PADDING_TOP = 16;
  const PADDING_RIGHT = 14;
  const PADDING_BOTTOM = 42;
  const PADDING_LEFT = 14;
  const BAR_GAP = 3;

  let {
    points,
    metricLabel = "USD",
    emptyMessage = "No chart data available",
  }: Props = $props();

  let activeIndex = $state<number | null>(null);

  function formatPointTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return timestamp;
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatExactTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return timestamp;
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatExactUsd(valueUsd: number): string {
    return valueUsd.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 12,
    });
  }

  const innerWidth = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const innerHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const maxValue = $derived.by(() => {
    const values = points.map((point) => point.valueUsd);
    const max = values.length > 0 ? Math.max(...values) : 0;
    return max > 0 ? max : 1;
  });

  const bars = $derived.by<HistogramBar[]>(() => {
    if (points.length === 0) return [];
    const barWidth = Math.max(
      1,
      (innerWidth - BAR_GAP * (points.length - 1)) / points.length,
    );

    return points.map((point, index) => {
      const scaledHeight = (point.valueUsd / maxValue) * innerHeight;
      const boundedHeight = Number.isFinite(scaledHeight)
        ? Math.max(0, scaledHeight)
        : 0;
      const x = PADDING_LEFT + index * (barWidth + BAR_GAP);
      const y = PADDING_TOP + (innerHeight - boundedHeight);

      return {
        index,
        x,
        y,
        width: barWidth,
        height: boundedHeight,
        timestamp: point.timestamp,
        valueUsd: point.valueUsd,
      };
    });
  });

  const axisLabelIndices = $derived.by(() => {
    if (points.length === 0) return [] as number[];
    const first = 0;
    const middle = Math.floor((points.length - 1) / 2);
    const last = points.length - 1;
    return Array.from(new Set([first, middle, last]));
  });

  const tooltipTargets = $derived.by<TooltipTarget[]>(() => {
    if (bars.length === 0) return [];

    const chartTopPercent = (PADDING_TOP / CHART_HEIGHT) * 100;
    const chartHeightPercent = (innerHeight / CHART_HEIGHT) * 100;

    return bars.map((bar) => ({
      index: bar.index,
      leftPercent: (bar.x / CHART_WIDTH) * 100,
      widthPercent: (bar.width / CHART_WIDTH) * 100,
      topPercent: chartTopPercent,
      heightPercent: chartHeightPercent,
      timestamp: bar.timestamp,
      valueUsd: bar.valueUsd,
    }));
  });

  const activeBar = $derived.by(() => {
    if (bars.length === 0) return null;
    const resolvedIndex =
      activeIndex !== null && activeIndex >= 0 && activeIndex < bars.length
        ? activeIndex
        : bars.length - 1;
    return bars[resolvedIndex] ?? null;
  });

  $effect(() => {
    if (bars.length === 0) {
      activeIndex = null;
      return;
    }

    if (activeIndex === null || activeIndex >= bars.length) {
      activeIndex = bars.length - 1;
    }
  });

  function setActiveIndex(index: number) {
    if (index < 0 || index >= bars.length) return;
    activeIndex = index;
  }
</script>

<div class="histogram-card">
  {#if activeBar}
    <div class="histogram-summary">
      <span class="summary-time">{formatPointTimestamp(activeBar.timestamp)}</span>
      <span class="summary-value">{metricLabel}: ${formatAmount(activeBar.valueUsd)}</span>
    </div>
  {/if}

  {#if bars.length === 0}
    <div class="empty-state">{emptyMessage}</div>
  {:else}
    <div class="chart-wrap">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        class="chart"
        aria-label="Histogram chart"
      >
        <line
          class="axis-line"
          x1={PADDING_LEFT}
          y1={PADDING_TOP + innerHeight}
          x2={CHART_WIDTH - PADDING_RIGHT}
          y2={PADDING_TOP + innerHeight}
        />

        {#each bars as bar (bar.index)}
          <rect
            class="bar"
            class:active={activeBar?.index === bar.index}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={Math.max(1, bar.height)}
            rx={3}
            ry={3}
          />
        {/each}

        {#each axisLabelIndices as pointIndex (pointIndex)}
          {@const point = bars[pointIndex]}
          {#if point}
            <text
              class="axis-label"
              x={point.x + point.width / 2}
              y={CHART_HEIGHT - 14}
              text-anchor="middle"
            >
              {formatPointTimestamp(point.timestamp)}
            </text>
          {/if}
        {/each}
      </svg>
      <div class="tooltip-layer">
        {#each tooltipTargets as target (target.index)}
          <div
            class="tooltip-hit"
            style={`left:${target.leftPercent}%;width:${target.widthPercent}%;top:${target.topPercent}%;height:${target.heightPercent}%;`}
          >
            <ResponsiveTooltip title={`${metricLabel} datapoint`}>
              {#snippet children()}
                <button
                  type="button"
                  class="tooltip-hit-target"
                  aria-label={`${formatExactTimestamp(target.timestamp)}: $${formatExactUsd(target.valueUsd)}`}
                  onmouseenter={() => setActiveIndex(target.index)}
                  ontouchstart={() => setActiveIndex(target.index)}
                ></button>
              {/snippet}
              {#snippet content()}
                <div class="tooltip-content">
                  <div class="tooltip-label">{metricLabel}</div>
                  <div class="tooltip-value">${formatExactUsd(target.valueUsd)}</div>
                  <div class="tooltip-time">{formatExactTimestamp(target.timestamp)}</div>
                </div>
              {/snippet}
            </ResponsiveTooltip>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .histogram-card {
    width: 100%;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.875rem;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .histogram-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    min-height: 1.5rem;
    flex-wrap: wrap;
  }

  .summary-time {
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  .summary-value {
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
  }

  .chart-wrap {
    position: relative;
    width: 100%;
    height: 220px;
  }

  .chart {
    width: 100%;
    height: 100%;
    display: block;
  }

  .axis-line {
    stroke: var(--border-color);
    stroke-width: 1;
  }

  .bar {
    fill: color-mix(in srgb, var(--accent-primary) 75%, transparent);
    transition:
      fill 0.15s ease,
      opacity 0.15s ease;
    opacity: 0.55;
  }

  .bar.active {
    fill: var(--accent-primary);
    opacity: 1;
  }

  .tooltip-layer {
    position: absolute;
    inset: 0;
  }

  .tooltip-hit {
    position: absolute;
  }

  .tooltip-hit-target {
    width: 100%;
    height: 100%;
    display: block;
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    cursor: default;
  }

  .tooltip-content {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .tooltip-label {
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .tooltip-value {
    color: var(--text-primary);
    font-size: 0.9rem;
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
  }

  .tooltip-time {
    color: var(--text-secondary);
    font-size: 0.8rem;
  }

  .axis-label {
    fill: var(--text-muted);
    font-size: 11px;
    user-select: none;
  }

  .empty-state {
    width: 100%;
    border-radius: 0.75rem;
    border: 1px dashed var(--border-color);
    color: var(--text-secondary);
    padding: 2rem 0.75rem;
    text-align: center;
    font-size: 0.875rem;
  }

  @media (--mobile) {
    .histogram-card {
      padding: 0.625rem;
    }

    .chart-wrap {
      height: 190px;
    }

    .axis-label {
      font-size: 10px;
    }
  }
</style>
