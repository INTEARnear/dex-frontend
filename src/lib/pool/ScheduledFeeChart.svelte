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

  interface GuideLine {
    label: string;
    yPercent: number;
  }

  interface RenderPoint {
    id: string;
    x: number;
    y: number;
    xRatio: number;
    yRatio: number;
    xPercent: number;
    yPercent: number;
  }

  interface RenderSegment {
    id: string;
    xPercent: number;
    yPercent: number;
    widthPx: number;
    angleDeg: number;
  }

  interface Props {
    points: ScheduledFeeChartPoint[];
    currentTimestampNanos?: number | null;
    showCurrentPoint?: boolean;
    tooltipTitle?: string;
    xAxisLabel?: string;
    formatTimeLabel?: (timestampNanos: number) => string;
  }

  let {
    points,
    currentTimestampNanos = null,
    showCurrentPoint = true,
    tooltipTitle = "Scheduled fee at point in time",
    xAxisLabel = "Time",
    formatTimeLabel,
  }: Props = $props();

  const width = 300;
  const height = 130;
  const left = 12;
  const right = 286;
  const top = 10;
  const bottom = 118;
  const plotLeftPercent = (left / width) * 100;
  const plotTopPercent = (top / height) * 100;
  const plotBottomPercent = (bottom / height) * 100;
  const plotWidthPercent = ((right - left) / width) * 100;
  const plotHeightPercent = ((bottom - top) / height) * 100;

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

  function toXPercent(x: number): number {
    return (x / width) * 100;
  }

  function toYPercent(y: number): number {
    return (y / height) * 100;
  }

  const guides = $derived.by<GuideLine[]>(() =>
    [0.25, 0.5, 0.75, 1].map((multiplier) => {
      const value = maxFeePercent * multiplier;
      const y = toY(value);
      return {
        label: `${formatPercentage(value)}%`,
        yPercent: toYPercent(y),
      };
    }),
  );

  const guideLabelsTopDown = $derived.by(() =>
    [...guides]
      .sort((a, b) => a.yPercent - b.yPercent)
      .map((guide) => guide.label),
  );

  const chartPoints = $derived.by<RenderPoint[]>(() =>
    normalizedPoints.map((point, index) => {
      const x = toX(point.timestampNanos);
      const y = toY(point.feePercent);
      const xRatio = x / width;
      const yRatio = y / height;
      return {
        id: `${point.timestampNanos}-${index}`,
        x,
        y,
        xRatio,
        yRatio,
        xPercent: xRatio * 100,
        yPercent: yRatio * 100,
      };
    }),
  );

  const chartSegments = $derived.by<RenderSegment[]>(() => {
    const segments: RenderSegment[] = [];
    for (let index = 0; index < chartPoints.length - 1; index++) {
      const start = chartPoints[index];
      const end = chartPoints[index + 1];
      const dxPx = (end.xRatio - start.xRatio) * plotWidthPx;
      const dyPx = (end.yRatio - start.yRatio) * plotHeightPx;
      const length = Math.hypot(dxPx, dyPx);
      if (length <= 0) continue;
      segments.push({
        id: `${start.id}-${end.id}`,
        xPercent: start.xPercent,
        yPercent: start.yPercent,
        widthPx: length,
        angleDeg: (Math.atan2(dyPx, dxPx) * 180) / Math.PI,
      });
    }
    return segments;
  });

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

  let plotElement = $state<HTMLDivElement | null>(null);
  let plotWidthPx = $state(width);
  let plotHeightPx = $state(height);
  const yLabelOffsetTopPx = $derived((top / height) * plotHeightPx);
  const yLabelStackHeightPx = $derived(((bottom - top) / height) * plotHeightPx);

  $effect(() => {
    if (!plotElement) return;
    const element = plotElement;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        plotWidthPx = rect.width;
        plotHeightPx = rect.height;
      }
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

  let hoverRatio = $state<number | null>(null);

  function updateHoverFromEvent(event: MouseEvent | TouchEvent): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    const plotLeftPx = rect.left;
    const plotWidthPx = rect.width;
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
    <div class="scheduled-chart-layout">
      <div class="scheduled-chart-y-axis">
        <div
          class="scheduled-chart-y-label-stack"
          style={`margin-top:${yLabelOffsetTopPx}px;height:${yLabelStackHeightPx}px;`}
        >
          {#each guideLabelsTopDown as label, index (index)}
            <span class="scheduled-chart-level-label">{label}</span>
          {/each}
        </div>
      </div>
      <div class="scheduled-chart-wrap">
        <div class="scheduled-chart-plot" bind:this={plotElement} aria-hidden="true">
          <div
            class="scheduled-chart-axis-line scheduled-chart-axis-line-y"
            style={`left:${plotLeftPercent}%;top:${plotTopPercent}%;height:${plotHeightPercent}%;`}
          ></div>
          <div
            class="scheduled-chart-axis-line scheduled-chart-axis-line-x"
            style={`left:${plotLeftPercent}%;top:${plotBottomPercent}%;width:${plotWidthPercent}%;`}
          ></div>
          {#each guides as guide, index (index)}
            <div
              class="scheduled-chart-guide"
              style={`left:${plotLeftPercent}%;top:${guide.yPercent}%;width:${plotWidthPercent}%;`}
            ></div>
          {/each}
          {#each chartSegments as segment (segment.id)}
            <div
              class="scheduled-chart-line-segment"
              style={`left:${segment.xPercent}%;top:${segment.yPercent}%;width:${segment.widthPx}px;transform:translateY(-50%) rotate(${segment.angleDeg}deg);`}
            ></div>
          {/each}
          {#each chartPoints as point (point.id)}
            <div
              class="scheduled-chart-point"
              style={`left:${point.xPercent}%;top:${point.yPercent}%;`}
            ></div>
          {/each}
          {#if currentPoint && showCurrentPoint}
            <div
              class="scheduled-chart-current-line"
              style={`left:${toXPercent(currentPoint.x)}%;top:${plotTopPercent}%;height:${plotHeightPercent}%;`}
            ></div>
            <div
              class="scheduled-chart-current-point"
              style={`left:${toXPercent(currentPoint.x)}%;top:${toYPercent(currentPoint.y)}%;`}
            ></div>
          {/if}
          {#if hoverPoint}
            <div
              class="scheduled-chart-hover-line"
              style={`left:${toXPercent(hoverPoint.x)}%;top:${plotTopPercent}%;height:${plotHeightPercent}%;`}
            ></div>
            <div
              class="scheduled-chart-hover-point"
              style={`left:${toXPercent(hoverPoint.x)}%;top:${toYPercent(hoverPoint.y)}%;`}
            ></div>
          {/if}
        </div>
        <div
          class="scheduled-chart-hit-layer"
          style={`left:${plotLeftPercent}%;top:${plotTopPercent}%;width:${plotWidthPercent}%;height:${plotHeightPercent}%;`}
        >
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
                ontouchend={updateHoverFromEvent}
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
    </div>
    <span class="scheduled-chart-axis-x">{xAxisLabel}</span>
  </div>
{/if}

<style>
  .scheduled-chart {
    padding: 0.625rem 0.625rem 0.625rem 0.25rem;
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    background: var(--bg-secondary);
  }

  .scheduled-chart-layout {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: stretch;
    padding-left: 0.25rem;
  }

  .scheduled-chart-y-axis {
    display: flex;
    align-items: flex-start;
    min-width: 0;
  }

  .scheduled-chart-y-label-stack {
    display: grid;
    grid-template-rows: repeat(4, minmax(0, 1fr));
    justify-items: end;
    align-content: stretch;
  }

  .scheduled-chart-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 300 / 130;
    min-height: 120px;
  }

  .scheduled-chart-plot {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .scheduled-chart-axis-line {
    position: absolute;
    background: var(--border-color);
    z-index: 1;
  }

  .scheduled-chart-axis-line-y {
    width: 1px;
    transform: translateX(-0.5px);
  }

  .scheduled-chart-axis-line-x {
    height: 1px;
    transform: translateY(-0.5px);
  }

  .scheduled-chart-guide {
    position: absolute;
    height: 1px;
    border-top: 1px dashed var(--border-color);
    transform: translateY(-0.5px);
    opacity: 0.75;
    z-index: 0;
    box-sizing: border-box;
  }

  .scheduled-chart-line-segment {
    position: absolute;
    height: 2px;
    border-radius: 999px;
    background: var(--accent-primary);
    transform-origin: left center;
    z-index: 2;
  }

  .scheduled-chart-point {
    position: absolute;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    transform: translate(-50%, -50%);
    z-index: 3;
  }

  .scheduled-chart-level-label {
    display: block;
    align-self: start;
    transform: translateY(-50%);
    color: var(--text-muted);
    font-size: 10px;
    font-family: "JetBrains Mono", monospace;
    line-height: 1;
    white-space: nowrap;
  }

  .scheduled-chart-hit-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
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
    position: absolute;
    width: 1px;
    border-left: 1px dashed color-mix(in oklab, var(--status-success-solid), transparent 25%);
    transform: translateX(-0.5px);
    z-index: 4;
  }

  .scheduled-chart-current-point {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-success-solid);
    border: 1.5px solid var(--bg-card);
    transform: translate(-50%, -50%);
    z-index: 5;
  }

  .scheduled-chart-hover-line {
    position: absolute;
    width: 1px;
    border-left: 1px dashed color-mix(in oklab, var(--accent-primary), transparent 25%);
    transform: translateX(-0.5px);
    z-index: 6;
  }

  .scheduled-chart-hover-point {
    position: absolute;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: white;
    border: 2px solid var(--accent-primary);
    transform: translate(-50%, -50%);
    z-index: 7;
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
