<script lang="ts">
  import ResponsiveTooltip from "../ResponsiveTooltip.svelte";

  const NANOS_PER_MILLISECOND = 1_000_000;

  export interface ScheduledFeeChartPoint {
    timestampNanos: number;
    feePercent: number;
  }

  interface HoverPoint {
    x: number;
    y: number;
    feePercent: number;
    timestampNanos: number;
  }

  interface Props {
    points: ScheduledFeeChartPoint[];
    currentTimestampNanos?: number | null;
    tooltipTitle?: string;
    xAxisLabel?: string;
    formatTimeLabel?: (timestampNanos: number) => string;
  }

  let {
    points,
    currentTimestampNanos = null,
    tooltipTitle = "Scheduled fee point",
    xAxisLabel = "Time",
    formatTimeLabel,
  }: Props = $props();

  const width = 300;
  const height = 130;
  const left = 44;
  const right = 286;
  const top = 10;
  const bottom = 92;

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function formatPercentage(value: number): string {
    return value.toFixed(4).replace(/\.?0+$/, "");
  }

  function defaultFormatTimeLabel(timestampNanos: number): string {
    return new Date(timestampNanos / NANOS_PER_MILLISECOND).toLocaleTimeString(
      undefined,
      {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      },
    );
  }

  function normalizePoints(
    rawPoints: ScheduledFeeChartPoint[],
  ): ScheduledFeeChartPoint[] {
    const sorted = rawPoints
      .filter(
        (point) =>
          Number.isFinite(point.timestampNanos) && Number.isFinite(point.feePercent),
      )
      .map((point) => ({
        timestampNanos: point.timestampNanos,
        feePercent: point.feePercent,
      }))
      .sort((a, b) => a.timestampNanos - b.timestampNanos);

    const deduped: ScheduledFeeChartPoint[] = [];
    for (const point of sorted) {
      const previous = deduped[deduped.length - 1];
      if (previous && previous.timestampNanos === point.timestampNanos) {
        previous.feePercent = point.feePercent;
        continue;
      }
      deduped.push(point);
    }

    if (deduped.length === 1) {
      deduped.push({
        timestampNanos: deduped[0].timestampNanos + 1,
        feePercent: deduped[0].feePercent,
      });
    }
    return deduped;
  }

  function getFeeAtTimestamp(
    chartPoints: ScheduledFeeChartPoint[],
    timestampNanos: number,
  ): number {
    if (chartPoints.length === 0) return 0;
    if (chartPoints.length === 1) return chartPoints[0].feePercent;

    if (timestampNanos <= chartPoints[0].timestampNanos) {
      return chartPoints[0].feePercent;
    }
    if (timestampNanos >= chartPoints[chartPoints.length - 1].timestampNanos) {
      return chartPoints[chartPoints.length - 1].feePercent;
    }

    for (let i = 0; i < chartPoints.length - 1; i++) {
      const start = chartPoints[i];
      const end = chartPoints[i + 1];
      if (timestampNanos < start.timestampNanos || timestampNanos > end.timestampNanos) {
        continue;
      }
      if (end.timestampNanos === start.timestampNanos) return end.feePercent;
      const ratio =
        (timestampNanos - start.timestampNanos) /
        (end.timestampNanos - start.timestampNanos);
      return start.feePercent + (end.feePercent - start.feePercent) * ratio;
    }

    return chartPoints[chartPoints.length - 1].feePercent;
  }

  const normalizedPoints = $derived.by(() => normalizePoints(points));
  const timeLabelFormatter = $derived(
    formatTimeLabel ?? defaultFormatTimeLabel,
  );

  const minTimestampNanos = $derived.by(() => {
    if (normalizedPoints.length === 0) return 0;
    const baseMin = normalizedPoints[0].timestampNanos;
    if (currentTimestampNanos === null) return baseMin;
    return Math.min(baseMin, currentTimestampNanos);
  });

  const maxTimestampNanos = $derived.by(() => {
    if (normalizedPoints.length === 0) return 1;
    const baseMax = normalizedPoints[normalizedPoints.length - 1].timestampNanos;
    const candidate =
      currentTimestampNanos === null ? baseMax : Math.max(baseMax, currentTimestampNanos);
    return candidate > minTimestampNanos ? candidate : minTimestampNanos + 1;
  });

  const maxFeePercent = $derived.by(() => {
    const maxFromPoints = normalizedPoints.reduce(
      (max, point) => Math.max(max, point.feePercent),
      0.0001,
    );
    if (currentTimestampNanos === null || normalizedPoints.length === 0) {
      return Math.max(maxFromPoints, 0.0001);
    }
    const currentFee = getFeeAtTimestamp(normalizedPoints, currentTimestampNanos);
    return Math.max(maxFromPoints, currentFee, 0.0001);
  });

  const plotHeight = $derived(bottom - top);
  const feeRange = $derived(Math.max(maxFeePercent, 0.0001));

  function toX(timestampNanos: number): number {
    const ratio =
      (timestampNanos - minTimestampNanos) / (maxTimestampNanos - minTimestampNanos);
    return left + clamp(ratio, 0, 1) * (right - left);
  }

  function toY(feePercent: number): number {
    return top + ((maxFeePercent - feePercent) / feeRange) * plotHeight;
  }

  const guides = $derived.by(() =>
    [0.25, 0.5, 0.75, 1].map((multiplier) => {
      const value = maxFeePercent * multiplier;
      return {
        label: `${formatPercentage(value)}%`,
        y: toY(value),
      };
    }),
  );

  const polylinePoints = $derived.by(() =>
    normalizedPoints
      .map((point) => `${toX(point.timestampNanos)},${toY(point.feePercent)}`)
      .join(" "),
  );

  const chartPoints = $derived.by(() =>
    normalizedPoints.map((point) => ({
      x: toX(point.timestampNanos),
      y: toY(point.feePercent),
    })),
  );

  const currentPoint = $derived.by(() => {
    if (currentTimestampNanos === null || normalizedPoints.length === 0) return null;
    const feePercent = getFeeAtTimestamp(normalizedPoints, currentTimestampNanos);
    return {
      x: toX(currentTimestampNanos),
      y: toY(feePercent),
      feePercent,
      timestampNanos: currentTimestampNanos,
    };
  });

  let hoverRatio = $state<number | null>(null);

  function updateHoverFromEvent(event: MouseEvent | TouchEvent): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return;

    const plotLeftPx = rect.left + (left / width) * rect.width;
    const plotRightPx = rect.left + (right / width) * rect.width;
    const plotWidthPx = plotRightPx - plotLeftPx;
    if (plotWidthPx <= 0) return;

    const clientX =
      event instanceof MouseEvent
        ? event.clientX
        : (event.touches[0]?.clientX ??
          event.changedTouches[0]?.clientX ??
          plotLeftPx);
    hoverRatio = clamp((clientX - plotLeftPx) / plotWidthPx, 0, 1);
  }

  function clearHover(): void {
    hoverRatio = null;
  }

  const hoverPoint = $derived.by<HoverPoint | null>(() => {
    if (hoverRatio === null || normalizedPoints.length === 0) return null;
    const timestampNanos =
      minTimestampNanos + (maxTimestampNanos - minTimestampNanos) * hoverRatio;
    const feePercent = getFeeAtTimestamp(normalizedPoints, timestampNanos);
    return {
      x: toX(timestampNanos),
      y: toY(feePercent),
      feePercent,
      timestampNanos,
    };
  });
</script>

{#if normalizedPoints.length > 0}
  <div class="scheduled-chart">
    <div class="scheduled-chart-wrap">
      <svg
        class="scheduled-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <line class="scheduled-chart-axis" x1={left} y1={top} x2={left} y2={bottom} />
        <line
          class="scheduled-chart-axis"
          x1={left}
          y1={bottom}
          x2={right}
          y2={bottom}
        />
        {#each guides as guide, index (index)}
          <line
            class="scheduled-chart-guide"
            x1={left}
            y1={guide.y}
            x2={right}
            y2={guide.y}
          />
          <text
            class="scheduled-chart-level-label"
            x={left - 6}
            y={guide.y + 3}
            text-anchor="end"
          >
            {guide.label}
          </text>
        {/each}
        <polyline class="scheduled-chart-line" points={polylinePoints} />
        {#each chartPoints as point, index (index)}
          <circle class="scheduled-chart-point" cx={point.x} cy={point.y} r="3" />
        {/each}
        {#if currentPoint}
          <line
            class="scheduled-chart-current-line"
            x1={currentPoint.x}
            y1={top}
            x2={currentPoint.x}
            y2={bottom}
          />
          <circle
            class="scheduled-chart-current-point"
            cx={currentPoint.x}
            cy={currentPoint.y}
            r="4"
          />
        {/if}
        {#if hoverPoint}
          <line
            class="scheduled-chart-hover-line"
            x1={hoverPoint.x}
            y1={top}
            x2={hoverPoint.x}
            y2={bottom}
          />
          <circle
            class="scheduled-chart-hover-point"
            cx={hoverPoint.x}
            cy={hoverPoint.y}
            r="3.5"
          />
        {/if}
      </svg>
      <div class="scheduled-chart-hit-layer">
        <ResponsiveTooltip title={tooltipTitle}>
          {#snippet children()}
            <button
              type="button"
              class="scheduled-chart-hit-target"
              aria-label="Inspect scheduled fee curve"
              onmouseenter={updateHoverFromEvent}
              onmousemove={updateHoverFromEvent}
              onmouseleave={clearHover}
              ontouchstart={updateHoverFromEvent}
              ontouchmove={updateHoverFromEvent}
              ontouchend={clearHover}
            ></button>
          {/snippet}
          {#snippet content()}
            {#if hoverPoint}
              <div class="scheduled-tooltip">
                <div class="scheduled-tooltip-fee">
                  {formatPercentage(hoverPoint.feePercent)}%
                </div>
                <div class="scheduled-tooltip-time">
                  {timeLabelFormatter(hoverPoint.timestampNanos)}
                </div>
              </div>
            {/if}
          {/snippet}
        </ResponsiveTooltip>
      </div>
    </div>
    <span class="scheduled-chart-axis-x">{xAxisLabel}</span>
  </div>
{/if}

<style>
  .scheduled-chart {
    padding: 0.625rem;
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    background: var(--bg-secondary);
  }

  .scheduled-chart-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 300 / 130;
    min-height: 120px;
  }

  .scheduled-chart-svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .scheduled-chart-axis {
    stroke: var(--border-color);
    stroke-width: 1;
  }

  .scheduled-chart-guide {
    stroke: var(--border-color);
    stroke-dasharray: 3 3;
    stroke-width: 1;
    opacity: 0.75;
  }

  .scheduled-chart-line {
    fill: none;
    stroke: var(--accent-primary);
    stroke-width: 2;
  }

  .scheduled-chart-point {
    fill: var(--accent-primary);
  }

  .scheduled-chart-level-label {
    fill: var(--text-muted);
    font-size: 8px;
    font-family: "JetBrains Mono", monospace;
  }

  .scheduled-chart-hit-layer {
    position: absolute;
    inset: 0;
  }

  .scheduled-chart-hit-target {
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
    cursor: crosshair;
    padding: 0;
  }

  .scheduled-chart-hit-target:focus-visible {
    outline: 1px solid var(--accent-primary);
    outline-offset: -1px;
    border-radius: 0.25rem;
  }

  .scheduled-chart-current-line {
    stroke: rgba(16, 185, 129, 0.75);
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }

  .scheduled-chart-current-point {
    fill: #10b981;
    stroke: white;
    stroke-width: 1.5;
  }

  .scheduled-chart-hover-line {
    stroke: rgba(59, 130, 246, 0.75);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }

  .scheduled-chart-hover-point {
    fill: white;
    stroke: var(--accent-primary);
    stroke-width: 2;
  }

  .scheduled-chart-axis-x {
    display: block;
    margin-top: 0.375rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .scheduled-tooltip {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .scheduled-tooltip-fee {
    font-size: 0.875rem;
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
    color: var(--text-primary);
  }

  .scheduled-tooltip-time {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  @media (--tablet) {
    .scheduled-chart-wrap {
      min-height: 110px;
    }
  }
</style>
