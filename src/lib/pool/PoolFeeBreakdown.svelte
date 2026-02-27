<script lang="ts">
  import type { XykFeeConfiguration, XykFeeReceiver } from "../types";
  import { formatFeePercent } from "../utils";
  import ScheduledFeeChart from "./ScheduledFeeChart.svelte";
  import {
    buildStackedScheduledFeeChartPoints,
    evaluateFeeConfigurationAtTimestamp,
    feeReceiverToLabel,
  } from "./feeUtils";

  interface Props {
    configuration: XykFeeConfiguration | null;
    label?: string;
  }

  let { configuration, label = "Fee" }: Props = $props();

  function shouldDisplayFeeReceiver(receiver: XykFeeReceiver): boolean {
    if (receiver !== "Pool") {
      return receiver.Account !== "plach.intear.near";
    }
    return true;
  }

  function formatFeePercentFixed(value: number, fractionDigits: number): string {
    return value.toFixed(fractionDigits);
  }

  let nowTimestampNanos = $state(Date.now() * 1_000_000);

  $effect(() => {
    if (!configuration) return;
    const currentNowNanos = Date.now() * 1_000_000;
    const hasScheduledFees = evaluateFeeConfigurationAtTimestamp(
      configuration,
      currentNowNanos,
    ).some(
      (entry) =>
        entry.kind === "scheduled" &&
        entry.endTimestampNanos !== undefined &&
        currentNowNanos <= entry.endTimestampNanos,
    );
    if (!hasScheduledFees) return;

    nowTimestampNanos = currentNowNanos;
    const timer = setInterval(() => {
      nowTimestampNanos = Date.now() * 1_000_000;
    }, 100);
    return () => clearInterval(timer);
  });

  const evaluatedFees = $derived.by(() => {
    if (!configuration) return [];
    return evaluateFeeConfigurationAtTimestamp(configuration, nowTimestampNanos);
  });

  const visibleEvaluatedFees = $derived.by(() =>
    evaluatedFees.filter((entry) => shouldDisplayFeeReceiver(entry.receiver)),
  );

  const totalFeePercent = $derived.by(() =>
    visibleEvaluatedFees.reduce((acc, entry) => acc + entry.feePercent, 0),
  );

  const feeBreakdown = $derived.by(() => {
    const feeByReceiver = new Map<string, number>();
    for (const entry of visibleEvaluatedFees) {
      const receiverLabel = feeReceiverToLabel(entry.receiver);
      feeByReceiver.set(
        receiverLabel,
        (feeByReceiver.get(receiverLabel) ?? 0) + entry.feePercent,
      );
    }
    return Array.from(feeByReceiver, ([receiver, feePercent]) => ({
      receiver,
      feePercent,
    }));
  });

  const hasUnfinishedScheduledFees = $derived.by(() =>
    visibleEvaluatedFees.some(
      (entry) =>
        entry.kind === "scheduled" &&
        entry.endTimestampNanos !== undefined &&
        nowTimestampNanos <= entry.endTimestampNanos,
    ),
  );

  const totalFeeLabel = $derived.by(() =>
    hasUnfinishedScheduledFees
      ? formatFeePercentFixed(totalFeePercent, 4)
      : formatFeePercent(totalFeePercent),
  );

  const scheduledFeeRows = $derived.by(() => {
    if (!hasUnfinishedScheduledFees) return [];
    return visibleEvaluatedFees.map((entry, index) => {
      const baseRow = {
        key: `${feeReceiverToLabel(entry.receiver)}-${index}`,
        receiver: feeReceiverToLabel(entry.receiver),
      };
      if (
        entry.kind === "scheduled" &&
        entry.startTimestampNanos !== undefined &&
        entry.endTimestampNanos !== undefined &&
        entry.startFeePercent !== undefined &&
        entry.endFeePercent !== undefined
      ) {
        const isMoving =
          nowTimestampNanos >= entry.startTimestampNanos &&
          nowTimestampNanos < entry.endTimestampNanos;
        const currentFeeLabel = isMoving
          ? formatFeePercentFixed(entry.feePercent, 4)
          : formatFeePercent(entry.feePercent);
        return {
          ...baseRow,
          value: `${formatFeePercent(entry.startFeePercent)}% -> ${formatFeePercent(entry.endFeePercent)}% (now ${currentFeeLabel}%)`,
        };
      }
      return {
        ...baseRow,
        value: `${formatFeePercent(entry.feePercent)}%`,
      };
    });
  });

  const scheduledFeeChartPoints = $derived.by(() => {
    if (!configuration || !hasUnfinishedScheduledFees) return [];
    return buildStackedScheduledFeeChartPoints(
      configuration,
      shouldDisplayFeeReceiver,
    );
  });
</script>

<div class="fee-breakdown">
  <div class="stat-row">
    <span class="stat-label">{label}</span>
    <span class="stat-value">
      {#if configuration}
        {totalFeeLabel}%
      {:else}
        N/A
      {/if}
    </span>
  </div>
  {#if configuration && feeBreakdown.length > 0 && !hasUnfinishedScheduledFees}
    {#each feeBreakdown as item (item.receiver)}
      <div class="stat-row fee-breakdown-row">
        <span class="stat-label fee-breakdown-label">{item.receiver}</span>
        <span class="stat-value fee-breakdown-value">
          {formatFeePercent(item.feePercent)}%
        </span>
      </div>
    {/each}
  {/if}
  {#if configuration && hasUnfinishedScheduledFees}
    <div class="scheduled-fees-section">
      {#each scheduledFeeRows as item (item.key)}
        <div class="stat-row fee-breakdown-row fee-schedule-row">
          <span class="stat-label fee-breakdown-label">{item.receiver}</span>
          <span class="stat-value fee-breakdown-value fee-schedule-value">
            {item.value}
          </span>
        </div>
      {/each}
      {#if scheduledFeeChartPoints.length > 0}
        <ScheduledFeeChart
          points={scheduledFeeChartPoints}
          currentTimestampNanos={nowTimestampNanos}
          tooltipTitle="Scheduled total fee"
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .fee-breakdown {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .stat-label {
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .stat-value {
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
    text-align: right;
  }

  .fee-breakdown-row {
    padding-left: 0.75rem;
  }

  .fee-breakdown-label {
    font-size: 0.75rem;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fee-breakdown-value {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .scheduled-fees-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }

  .fee-schedule-row {
    align-items: flex-start;
  }

  .fee-schedule-value {
    font-size: 0.75rem;
    line-height: 1.35;
    white-space: normal;
  }
</style>
