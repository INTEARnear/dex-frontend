<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import ResponsiveTooltip from "../ResponsiveTooltip.svelte";
  import { formatAmount } from "../utils";
  import type { StatsSeriesPoint, StatsTimeframe } from "./types";

  interface HistogramBar {
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
    topPercent: number;
    heightPercent: number;
    timestamp: string;
    valueUsd: number;
  }

  interface Props {
    points: StatsSeriesPoint[];
    metricLabel?: string;
    emptyMessage?: string;
    summaryMode?: "sum" | "latest";
    timeframe: StatsTimeframe;
  }

  interface TooltipTarget {
    index: number;
    leftPx: number;
    widthPx: number;
    topPercent: number;
    heightPercent: number;
    timestamp: string;
    valueUsd: number;
  }

  interface YAxisTick {
    y: number;
    value: number;
    label: string;
    topPercent: number;
  }

  interface AxisLabel {
    index: number;
    label: string;
    leftPx: number;
    align: "start" | "center" | "end";
  }

  const CHART_HEIGHT = 300;
  const PADDING_TOP = 16;
  const PADDING_RIGHT = 14;
  const PADDING_BOTTOM = 42;
  const PADDING_LEFT = 6;
  const BAR_GAP = 4;
  const MIN_BAR_WIDTH = 8;
  const DRAG_ACTIVATE_DISTANCE = 4;
  const DESKTOP_INERTIA_MIN_VELOCITY = 0.01;
  const DESKTOP_INERTIA_FRICTION = 0.92;
  const DESKTOP_INERTIA_MAX_DURATION_MS = 1000;

  let {
    points,
    metricLabel = "USD",
    emptyMessage = "No chart data available",
    summaryMode = "latest",
    timeframe,
  }: Props = $props();

  let activeIndex = $state<number | null>(null);
  let plotScrollElelemt = $state<HTMLDivElement | null>(null);
  let plotViewportWidth = $state(0);
  let scrollLeft = $state(0);
  let maxScrollLeft = $state(0);
  let hasOverflow = $state(false);
  let shouldAutoScrollRight = $state(true);
  let suppressHoverUntil = $state(0);
  let isPointerPressed = $state(false);
  let isDragging = $state(false);

  let dragStartX = 0;
  let dragStartScrollLeft = 0;
  let dragLastTime = 0;
  let dragVelocity = 0;
  let activePointerId: number | null = null;
  let isSyncingScroll = false;
  let inertiaFrameId: number | null = null;

  const isDailyCandles = $derived(timeframe === "Month");

  function formatPointTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return timestamp;
    if (isDailyCandles) {
      return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year:
          date.getFullYear() !== new Date().getFullYear()
            ? "numeric"
            : undefined,
      });
    }
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
    if (isDailyCandles) {
      return date.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
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

  function formatYAxisLabel(valueUsd: number): string {
    if (valueUsd === 0) return "$0";
    if (valueUsd >= 1000) {
      return `$${valueUsd.toLocaleString(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      })}`;
    }
    return `$${formatAmount(valueUsd)}`;
  }

  const innerHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const axisLineTopPercent = ((PADDING_TOP + innerHeight) / CHART_HEIGHT) * 100;
  const xAxisLabelTopPercent =
    ((PADDING_TOP + innerHeight + 14) / CHART_HEIGHT) * 100;

  const maxValue = $derived.by(() => {
    const values = points.map((point) => point.valueUsd);
    const max = values.length > 0 ? Math.max(...values) : 0;
    return max > 0 ? max : 1;
  });

  const minInnerWidth = $derived.by(() => {
    if (points.length === 0) return 0;
    return (
      points.length * MIN_BAR_WIDTH + BAR_GAP * Math.max(0, points.length - 1)
    );
  });

  const viewportInnerWidth = $derived.by(() => {
    return Math.max(0, plotViewportWidth - PADDING_LEFT - PADDING_RIGHT);
  });

  const innerWidth = $derived.by(() => {
    return Math.max(minInnerWidth, viewportInnerWidth);
  });

  const plotContentWidth = $derived.by(() => {
    return innerWidth + PADDING_LEFT + PADDING_RIGHT;
  });

  const bars = $derived.by<HistogramBar[]>(() => {
    if (points.length === 0) return [];
    const barWidth = Math.max(
      MIN_BAR_WIDTH,
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
        topPercent: (y / CHART_HEIGHT) * 100,
        heightPercent: (boundedHeight / CHART_HEIGHT) * 100,
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

  const yAxisTicks = $derived.by<YAxisTick[]>(() => {
    const tickSteps = 4;
    return Array.from({ length: tickSteps + 1 }, (_, index) => {
      const ratio = index / tickSteps;
      const y = PADDING_TOP + innerHeight * ratio;
      const value = maxValue * (1 - ratio);
      return {
        y,
        value,
        label: formatYAxisLabel(value),
        topPercent: (y / CHART_HEIGHT) * 100,
      };
    });
  });

  const axisLabels = $derived.by<AxisLabel[]>(() => {
    if (bars.length === 0) return [];

    return axisLabelIndices
      .map((pointIndex) => {
        const point = bars[pointIndex];
        if (!point) return null;

        if (pointIndex === 0) {
          return {
            index: pointIndex,
            label: formatPointTimestamp(point.timestamp),
            leftPx: point.x,
            align: "start" as const,
          };
        }

        if (pointIndex === bars.length - 1) {
          return {
            index: pointIndex,
            label: formatPointTimestamp(point.timestamp),
            leftPx: point.x + point.width,
            align: "end" as const,
          };
        }

        return {
          index: pointIndex,
          label: formatPointTimestamp(point.timestamp),
          leftPx: point.x + point.width / 2,
          align: "center" as const,
        };
      })
      .filter((label): label is AxisLabel => label !== null);
  });

  const tooltipTargets = $derived.by<TooltipTarget[]>(() => {
    if (bars.length === 0) return [];

    const chartTopPercent = (PADDING_TOP / CHART_HEIGHT) * 100;
    const chartHeightPercent = (innerHeight / CHART_HEIGHT) * 100;

    return bars.map((bar) => {
      // When hovering gap, hit the closest bar
      const i = bar.index;
      const n = bars.length;
      const hitLeft = bar.x - (i > 0 ? BAR_GAP / 2 : 0);
      const hitWidth =
        bar.width + (i > 0 ? BAR_GAP / 2 : 0) + (i < n - 1 ? BAR_GAP / 2 : 0);
      return {
        index: bar.index,
        leftPx: hitLeft,
        widthPx: hitWidth,
        topPercent: chartTopPercent,
        heightPercent: chartHeightPercent,
        timestamp: bar.timestamp,
        valueUsd: bar.valueUsd,
      };
    });
  });

  const activeBar = $derived.by(() => {
    if (bars.length === 0 || activeIndex === null) return null;
    if (activeIndex < 0 || activeIndex >= bars.length) return null;
    return bars[activeIndex] ?? null;
  });

  const latestBar = $derived.by(() => {
    if (bars.length === 0) return null;
    return bars[bars.length - 1] ?? null;
  });

  const defaultSummaryValue = $derived.by(() => {
    if (bars.length === 0) return 0;
    if (summaryMode === "sum") {
      return bars.reduce((sum, bar) => sum + bar.valueUsd, 0);
    }
    return latestBar?.valueUsd ?? 0;
  });

  const summaryValueUsd = $derived.by(() => {
    return activeBar?.valueUsd ?? defaultSummaryValue;
  });

  const summaryTimeLabel = $derived.by(() => {
    if (activeBar) return formatPointTimestamp(activeBar.timestamp);
    if (summaryMode === "sum") return "Total in selected range";
    return latestBar ? formatPointTimestamp(latestBar.timestamp) : "";
  });

  const dataScrollKey = $derived.by(() => {
    if (points.length === 0) return "empty";
    const firstTimestamp = points[0]?.timestamp ?? "";
    const lastTimestamp = points[points.length - 1]?.timestamp ?? "";
    return `${points.length}:${firstTimestamp}:${lastTimestamp}`;
  });

  const showLeftFade = $derived.by(() => {
    return hasOverflow && scrollLeft > 1;
  });

  const showRightFade = $derived.by(() => {
    return hasOverflow && scrollLeft < maxScrollLeft - 1;
  });

  onDestroy(() => {
    cancelInertia();
  });

  $effect(() => {
    if (bars.length === 0) {
      activeIndex = null;
      return;
    }

    if (activeIndex !== null && activeIndex >= bars.length) {
      activeIndex = bars.length - 1;
    }
  });

  $effect(() => {
    void dataScrollKey;
    shouldAutoScrollRight = true;
  });

  $effect(() => {
    const element = plotScrollElelemt;
    if (!element) return;

    const observer = new ResizeObserver(() => {
      updateScrollMetrics();
    });
    observer.observe(element);

    const canvas = element.querySelector(".plot-canvas");
    if (canvas instanceof HTMLElement) {
      observer.observe(canvas);
    }

    updateScrollMetrics();

    return () => {
      observer.disconnect();
    };
  });

  $effect(() => {
    const noElement = !plotScrollElelemt;
    const noBars = bars.length === 0;
    const noAutoScroll = !shouldAutoScrollRight;
    void plotContentWidth;

    if (noElement || noBars || noAutoScroll) return;

    let cancelled = false;
    (async () => {
      await tick();
      if (cancelled) return;

      const current = plotScrollElelemt;
      if (!current) return;

      const nextMaxScrollLeft = Math.max(
        0,
        current.scrollWidth - current.clientWidth,
      );
      isSyncingScroll = true;
      current.scrollLeft = nextMaxScrollLeft;
      scrollLeft = current.scrollLeft;
      maxScrollLeft = nextMaxScrollLeft;
      hasOverflow = nextMaxScrollLeft > 0;
      queueMicrotask(() => {
        isSyncingScroll = false;
      });
      shouldAutoScrollRight = false;
    })();

    return () => {
      cancelled = true;
    };
  });

  function updateScrollMetrics() {
    const element = plotScrollElelemt;
    if (!element) {
      plotViewportWidth = 0;
      scrollLeft = 0;
      maxScrollLeft = 0;
      hasOverflow = false;
      return;
    }

    plotViewportWidth = element.clientWidth;
    const nextMaxScrollLeft = Math.max(
      0,
      element.scrollWidth - element.clientWidth,
    );
    maxScrollLeft = nextMaxScrollLeft;
    hasOverflow = nextMaxScrollLeft > 0;

    if (element.scrollLeft > nextMaxScrollLeft) {
      isSyncingScroll = true;
      element.scrollLeft = nextMaxScrollLeft;
      queueMicrotask(() => {
        isSyncingScroll = false;
      });
    }

    scrollLeft = element.scrollLeft;
  }

  function setActiveIndex(index: number) {
    if (Date.now() < suppressHoverUntil) return;
    if (isDragging) return;
    if (index < 0 || index >= bars.length) return;
    activeIndex = index;
  }

  function clearActiveIndex() {
    if (isDragging) return;
    activeIndex = null;
  }

  function handleScroll() {
    updateScrollMetrics();
    if (!isSyncingScroll) {
      shouldAutoScrollRight = false;
    }
  }

  function cancelInertia() {
    if (inertiaFrameId !== null) {
      cancelAnimationFrame(inertiaFrameId);
      inertiaFrameId = null;
    }
  }

  function startDesktopInertia(initialVelocity: number) {
    const element = plotScrollElelemt;
    if (!element || !hasOverflow) return;
    if (Math.abs(initialVelocity) < DESKTOP_INERTIA_MIN_VELOCITY) return;

    cancelInertia();
    shouldAutoScrollRight = false;
    suppressHoverUntil = Date.now() + 220;
    activeIndex = null;

    let velocity = initialVelocity;
    let lastFrameTs = performance.now();
    let elapsedMs = 0;

    const step = (timestamp: number) => {
      const current = plotScrollElelemt;
      if (!current) {
        inertiaFrameId = null;
        return;
      }

      const dt = Math.max(1, Math.min(32, timestamp - lastFrameTs));
      lastFrameTs = timestamp;
      elapsedMs += dt;

      const previousScrollLeft = current.scrollLeft;
      current.scrollLeft = previousScrollLeft + velocity * dt;
      const appliedDelta = current.scrollLeft - previousScrollLeft;

      velocity *= Math.pow(DESKTOP_INERTIA_FRICTION, dt / 16.667);

      if (
        elapsedMs >= DESKTOP_INERTIA_MAX_DURATION_MS ||
        Math.abs(velocity) < DESKTOP_INERTIA_MIN_VELOCITY ||
        Math.abs(appliedDelta) < 0.1
      ) {
        inertiaFrameId = null;
        return;
      }

      inertiaFrameId = requestAnimationFrame(step);
    };

    inertiaFrameId = requestAnimationFrame(step);
  }

  function stopDragging(pointerId: number, withInertia: boolean) {
    const element = plotScrollElelemt;
    const releaseVelocity = dragVelocity;
    const wasDragging = isDragging;
    if (element && element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    if (isDragging) {
      suppressHoverUntil = Date.now() + 180;
    }
    isPointerPressed = false;
    isDragging = false;
    activePointerId = null;
    dragVelocity = 0;

    if (withInertia && wasDragging) {
      startDesktopInertia(releaseVelocity);
    }
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    if (event.button !== 0) return;

    const element = plotScrollElelemt;
    if (!element) return;

    const canDrag = hasOverflow;
    if (!canDrag) return;

    cancelInertia();
    activePointerId = event.pointerId;
    isPointerPressed = true;
    isDragging = false;
    dragStartX = event.clientX;
    dragStartScrollLeft = element.scrollLeft;
    dragLastTime = performance.now();
    dragVelocity = 0;
    suppressHoverUntil = Date.now() + 120;
    activeIndex = null;
    element.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isPointerPressed) return;
    if (activePointerId !== event.pointerId) return;

    const element = plotScrollElelemt;
    if (!element) return;

    const deltaX = event.clientX - dragStartX;
    let shouldSampleVelocity = isDragging;
    if (!isDragging && Math.abs(deltaX) >= DRAG_ACTIVATE_DISTANCE) {
      isDragging = true;
      suppressHoverUntil = Date.now() + 120;
      dragLastTime = performance.now();
      dragVelocity = 0;
      shouldSampleVelocity = false;
    }

    if (!isDragging) return;

    shouldAutoScrollRight = false;
    const previousScrollLeft = element.scrollLeft;
    element.scrollLeft = dragStartScrollLeft - deltaX;
    if (shouldSampleVelocity) {
      const now = performance.now();
      const dt = Math.max(1, now - dragLastTime);
      const appliedDelta = element.scrollLeft - previousScrollLeft;
      const instantVelocity = appliedDelta / dt;
      dragVelocity = dragVelocity * 0.68 + instantVelocity * 0.32;
      dragLastTime = now;
    }
    if (activeIndex !== null) {
      activeIndex = null;
    }
    event.preventDefault();
  }

  function handlePointerUp(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return;
    stopDragging(event.pointerId, true);
  }

  function handlePointerCancel(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return;
    stopDragging(event.pointerId, false);
  }

  function handlePointerLeave(event: PointerEvent) {
    if (!isPointerPressed) return;
    if (activePointerId !== event.pointerId) return;
    stopDragging(event.pointerId, false);
  }

  function handleLostPointerCapture(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return;
    if (isDragging) {
      suppressHoverUntil = Date.now() + 180;
    }
    cancelInertia();
    isPointerPressed = false;
    isDragging = false;
    activePointerId = null;
    dragVelocity = 0;
  }
</script>

<div class="histogram-card">
  {#if bars.length > 0}
    <div class="histogram-summary">
      <span class="summary-time">{summaryTimeLabel}</span>
      <span class="summary-value"
        >{metricLabel}: ${formatAmount(summaryValueUsd)}</span
      >
    </div>
  {/if}

  {#if bars.length === 0}
    <div class="empty-state">{emptyMessage}</div>
  {:else}
    <div
      class="chart-shell"
      class:dragging={isDragging}
      role="img"
      aria-label="Histogram chart"
    >
      <div class="y-axis-rail" aria-hidden="true">
        {#each yAxisTicks as tick, index (index)}
          <span class="y-axis-label" style={`top:${tick.topPercent}%;`}>
            {tick.label}
          </span>
        {/each}
      </div>

      <div class="plot-region">
        <div
          class="plot-scroll"
          class:overflowing={hasOverflow}
          class:pressed={isPointerPressed || isDragging}
          role="region"
          aria-label="Histogram plot area"
          bind:this={plotScrollElelemt}
          onscroll={handleScroll}
          onpointerdown={handlePointerDown}
          onpointermove={handlePointerMove}
          onpointerup={handlePointerUp}
          onpointercancel={handlePointerCancel}
          onpointerleave={handlePointerLeave}
          onlostpointercapture={handleLostPointerCapture}
        >
          <div class="plot-canvas" style={`width:${plotContentWidth}px;`}>
            {#each yAxisTicks as tick, index (index)}
              <div class="y-grid-line" style={`top:${tick.topPercent}%;`}></div>
            {/each}

            <div class="axis-line" style={`top:${axisLineTopPercent}%;`}></div>

            {#each bars as bar (bar.index)}
              <div
                class="bar"
                class:active={activeBar?.index === bar.index}
                style={`left:${bar.x}px;width:${bar.width}px;top:${bar.topPercent}%;height:${bar.heightPercent}%;`}
              ></div>
            {/each}

            {#each axisLabels as label (label.index)}
              <span
                class="axis-label"
                class:start={label.align === "start"}
                class:center={label.align === "center"}
                class:end={label.align === "end"}
                style={`left:${label.leftPx}px;top:${xAxisLabelTopPercent}%;`}
              >
                {label.label}
              </span>
            {/each}

            <div class="tooltip-layer">
              {#each tooltipTargets as target (target.index)}
                <div
                  class="tooltip-hit"
                  style={`left:${target.leftPx}px;width:${target.widthPx}px;top:${target.topPercent}%;height:${target.heightPercent}%;`}
                >
                  <ResponsiveTooltip title={`${metricLabel} datapoint`}>
                    {#snippet children()}
                      <button
                        type="button"
                        class="tooltip-hit-target"
                        aria-label={`${formatExactTimestamp(target.timestamp)}: $${formatExactUsd(target.valueUsd)}`}
                        onmouseenter={() => setActiveIndex(target.index)}
                        onmouseleave={clearActiveIndex}
                        onfocus={() => setActiveIndex(target.index)}
                        onblur={clearActiveIndex}
                        ontouchstart={() => setActiveIndex(target.index)}
                      ></button>
                    {/snippet}
                    {#snippet content()}
                      <div class="tooltip-content">
                        <div class="tooltip-label">{metricLabel}</div>
                        <div class="tooltip-value">
                          ${formatExactUsd(target.valueUsd)}
                        </div>
                        <div class="tooltip-time">
                          {formatExactTimestamp(target.timestamp)}
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>
                </div>
              {/each}
            </div>
          </div>
        </div>
        <div
          class="left-fade"
          class:visible={showLeftFade}
          aria-hidden="true"
        ></div>
        <div
          class="right-fade"
          class:visible={showRightFade}
          aria-hidden="true"
        ></div>
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

  .chart-shell {
    --chart-height: clamp(170px, 24vw, 220px);
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    align-items: stretch;
    gap: 0.25rem;
  }

  .chart-shell.dragging {
    user-select: none;
  }

  .y-axis-rail {
    position: sticky;
    left: 0;
    z-index: 6;
    height: var(--chart-height);
    border-right: 1px solid
      color-mix(in srgb, var(--border-color) 70%, transparent);
    padding-right: 0.35rem;
    background: var(--bg-input);
  }

  .y-axis-label {
    position: absolute;
    right: 0.35rem;
    transform: translateY(-50%);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    user-select: none;
    pointer-events: none;
  }

  .plot-region {
    position: relative;
    min-width: 0;
    height: var(--chart-height);
  }

  .plot-scroll {
    position: relative;
    overflow-x: hidden;
    overflow-y: hidden;
    height: 100%;
    cursor: default;
    scrollbar-width: none;
    -ms-overflow-style: none;
    overscroll-behavior-x: contain;
  }

  .plot-scroll.overflowing {
    overflow-x: auto;
  }

  .plot-scroll::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  .plot-scroll.pressed {
    cursor: grab;
  }

  .left-fade {
    position: absolute;
    inset: 0 auto 0 0;
    width: 72px;
    pointer-events: none;
    opacity: 0;
    z-index: 5;
    transition: opacity 320ms ease-out;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--bg-input) 90%, transparent) 0%,
      color-mix(in srgb, var(--bg-input) 78%, transparent) 24%,
      color-mix(in srgb, var(--bg-input) 56%, transparent) 50%,
      color-mix(in srgb, var(--bg-input) 32%, transparent) 76%,
      transparent 100%
    );
  }

  .left-fade.visible {
    opacity: 0.98;
  }

  .right-fade {
    position: absolute;
    inset: 0 0 0 auto;
    width: 72px;
    pointer-events: none;
    opacity: 0;
    z-index: 5;
    transition: opacity 320ms ease-out;
    background: linear-gradient(
      270deg,
      color-mix(in srgb, var(--bg-input) 90%, transparent) 0%,
      color-mix(in srgb, var(--bg-input) 78%, transparent) 24%,
      color-mix(in srgb, var(--bg-input) 56%, transparent) 50%,
      color-mix(in srgb, var(--bg-input) 32%, transparent) 76%,
      transparent 100%
    );
  }

  .right-fade.visible {
    opacity: 0.98;
  }

  .plot-canvas {
    position: relative;
    min-width: 100%;
    height: 100%;
  }

  .y-grid-line,
  .axis-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    pointer-events: none;
  }

  .y-grid-line {
    background: color-mix(in srgb, var(--border-color) 70%, transparent);
    z-index: 0;
  }

  .axis-line {
    background: var(--border-color);
    z-index: 1;
  }

  .bar {
    position: absolute;
    border-radius: 4px 4px 0 0;
    min-height: 1px;
    background: color-mix(in srgb, var(--accent-primary) 75%, transparent);
    transition:
      background-color 0.15s ease,
      opacity 0.15s ease;
    opacity: 0.55;
    z-index: 2;
    pointer-events: none;
  }

  .bar.active {
    background: var(--accent-primary);
    opacity: 1;
  }

  .axis-label {
    position: absolute;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
    user-select: none;
    white-space: nowrap;
    z-index: 3;
    pointer-events: none;
  }

  .axis-label.start {
    transform: none;
    text-align: left;
  }

  .axis-label.center {
    transform: translateX(-50%);
    text-align: center;
  }

  .axis-label.end {
    transform: translateX(-100%);
    text-align: right;
  }

  .tooltip-layer {
    position: absolute;
    inset: 0;
    z-index: 4;
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

  .plot-scroll.pressed .tooltip-hit-target {
    cursor: grab;
  }

  .chart-shell.dragging .tooltip-hit-target {
    cursor: grab;
    pointer-events: none;
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

    .chart-shell {
      --chart-height: 170px;
      grid-template-columns: 50px minmax(0, 1fr);
    }

    .axis-label {
      font-size: 11px;
    }

    .y-axis-label {
      font-size: 11px;
    }

    .left-fade,
    .right-fade {
      width: 52px;
    }
  }
</style>
