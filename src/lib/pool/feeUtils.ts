import type {
  XykFeeAmount,
  XykFeeConfiguration,
  XykFeeReceiver,
} from "../types";
import type { SchemaXykFeeAmount, SchemaXykFeeReceiver } from "../xykSchemas";

const NANOS_PER_MILLISECOND = 1_000_000;
const NANOS_PER_SECOND = 1_000_000_000;
const FEE_FRACTION_SCALE = 10_000;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;

type FixedFeeAmountDraftInput = {
  kind: "fixed";
  percentage: string;
};

type ScheduledFeeAmountDraftInput = {
  kind: "scheduled";
  startDateTime: string;
  durationHours: string;
  durationMinutes: string;
  startPercentage: string;
  endPercentage: string;
  startPreset: "custom" | "now";
};

export type FeeAmountDraftInput =
  | FixedFeeAmountDraftInput
  | ScheduledFeeAmountDraftInput;

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}

function parseDurationInput(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function timestampNanosToDateTimeLocal(timestampNanos: number): string {
  const milliseconds = timestampNanos / NANOS_PER_MILLISECOND;
  const date = new Date(milliseconds);
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

export function nowDateTimeLocal(): string {
  return timestampNanosToDateTimeLocal(Date.now() * NANOS_PER_MILLISECOND);
}

export function dateTimeLocalToTimestampNanos(value: string): number {
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw new Error("Invalid scheduled fee datetime");
  }
  return milliseconds * NANOS_PER_MILLISECOND;
}

export function tryDateTimeLocalToTimestampNanos(value: string): number | null {
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds)
    ? null
    : milliseconds * NANOS_PER_MILLISECOND;
}

export function durationToNanoseconds(
  hoursInput: string,
  minutesInput: string,
): number | null {
  const hours = parseDurationInput(hoursInput);
  const minutes = parseDurationInput(minutesInput);
  if (
    hours === null ||
    minutes === null ||
    hours < 0 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  const totalMinutes = hours * MINUTES_PER_HOUR + minutes;
  if (totalMinutes <= 0) return null;

  return totalMinutes * SECONDS_PER_MINUTE * NANOS_PER_SECOND;
}

export function scheduledDurationFromPoints(
  startTimestampNanos: number,
  endTimestampNanos: number,
): { durationHours: string; durationMinutes: string } {
  const diffNanos = endTimestampNanos - startTimestampNanos;
  const diffMs = diffNanos / NANOS_PER_MILLISECOND;
  const totalMinutes = Math.max(
    1,
    Math.round(diffMs / (SECONDS_PER_MINUTE * 1000)),
  );
  const durationHours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const durationMinutes = totalMinutes % MINUTES_PER_HOUR;

  return {
    durationHours: durationHours.toString(),
    durationMinutes: durationMinutes.toString(),
  };
}

export function percentageToFeeFraction(percentage: string): number {
  return Math.round((Number.parseFloat(percentage) || 0) * FEE_FRACTION_SCALE);
}

export function feeFractionToPercentage(feeFraction: number): string {
  return (feeFraction / FEE_FRACTION_SCALE).toString();
}

export function toSchemaFeeReceiver(
  receiver: XykFeeReceiver,
): SchemaXykFeeReceiver {
  return receiver === "Pool" ? { Pool: {} } : { Account: receiver.Account };
}

export function draftAmountToSchemaXykFeeAmount(
  amount: FeeAmountDraftInput,
  nowTimestampNanos = Date.now() * NANOS_PER_MILLISECOND,
): SchemaXykFeeAmount | null {
  if (amount.kind === "fixed") {
    const feeFraction = percentageToFeeFraction(amount.percentage);
    return feeFraction > 0 ? { Fixed: feeFraction } : null;
  }

  const startFeeFraction = percentageToFeeFraction(amount.startPercentage);
  const endFeeFraction = percentageToFeeFraction(amount.endPercentage);
  if (startFeeFraction <= 0 && endFeeFraction <= 0) return null;
  if (endFeeFraction >= startFeeFraction) {
    throw new Error("Scheduled fee end must be lower than start fee");
  }

  const durationNs = durationToNanoseconds(
    amount.durationHours,
    amount.durationMinutes,
  );
  if (durationNs === null) {
    throw new Error("Duration must be set");
  }

  const startTimestampNanos =
    amount.startPreset === "now"
      ? nowTimestampNanos
      : dateTimeLocalToTimestampNanos(amount.startDateTime);
  const endTimestampNanos = startTimestampNanos + durationNs;
  if (endTimestampNanos <= startTimestampNanos) {
    throw new Error("Duration must be set");
  }

  return {
    Scheduled: {
      start: {
        timestampNanos: startTimestampNanos,
        feeFraction: startFeeFraction,
      },
      end: { timestampNanos: endTimestampNanos, feeFraction: endFeeFraction },
      curve: { Linear: {} },
    },
  };
}

type NormalizedFeeAmount =
  | { kind: "fixed"; feeFraction: number }
  | {
      kind: "scheduled";
      startTimestampNanos: number;
      endTimestampNanos: number;
      startFeeFraction: number;
      endFeeFraction: number;
    }
  | { kind: "dynamic"; minFeeFraction: number; maxFeeFraction: number };

interface NormalizedFeeConfigurationEntry {
  receiver: XykFeeReceiver;
  amount: NormalizedFeeAmount;
}

export interface EvaluatedFeeConfigurationEntry {
  receiver: XykFeeReceiver;
  kind: "fixed" | "scheduled" | "dynamic";
  feeFraction: number;
  feePercent: number;
  startTimestampNanos?: number;
  endTimestampNanos?: number;
  startFeePercent?: number;
  endFeePercent?: number;
}

export interface ScheduledFeeChartPoint {
  timestampNanos: number;
  feePercent: number;
}

function toFiniteNumberOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizeFeeAmount(
  amount: number | XykFeeAmount,
): NormalizedFeeAmount {
  if (typeof amount === "number") {
    return {
      kind: "fixed",
      feeFraction: toFiniteNumberOrZero(amount),
    };
  }
  if ("Fixed" in amount) {
    return {
      kind: "fixed",
      feeFraction: toFiniteNumberOrZero(amount.Fixed),
    };
  }
  if ("Scheduled" in amount) {
    return {
      kind: "scheduled",
      startTimestampNanos: toFiniteNumberOrZero(amount.Scheduled.start[0]),
      endTimestampNanos: toFiniteNumberOrZero(amount.Scheduled.end[0]),
      startFeeFraction: toFiniteNumberOrZero(amount.Scheduled.start[1]),
      endFeeFraction: toFiniteNumberOrZero(amount.Scheduled.end[1]),
    };
  }
  return {
    kind: "dynamic",
    minFeeFraction: toFiniteNumberOrZero(amount.Dynamic.min),
    maxFeeFraction: toFiniteNumberOrZero(amount.Dynamic.max),
  };
}

function normalizeFeeConfigurationEntries(
  configuration: XykFeeConfiguration,
): NormalizedFeeConfigurationEntry[] {
  return configuration.receivers.map(([receiver, amount]) => ({
    receiver,
    amount: normalizeFeeAmount(amount),
  }));
}

function evaluateNormalizedFeeAmountAtTimestamp(
  amount: NormalizedFeeAmount,
  timestampNanos: number,
): number {
  if (amount.kind === "fixed") return amount.feeFraction;
  if (amount.kind === "dynamic") {
    // Dynamic fees require runtime pool state not present in fee configuration.
    // Use max as a conservative fallback.
    return amount.maxFeeFraction;
  }

  const {
    startTimestampNanos,
    endTimestampNanos,
    startFeeFraction,
    endFeeFraction,
  } = amount;
  if (endTimestampNanos <= startTimestampNanos) return endFeeFraction;
  if (timestampNanos <= startTimestampNanos) return startFeeFraction;
  if (timestampNanos >= endTimestampNanos) return endFeeFraction;

  const ratio =
    (timestampNanos - startTimestampNanos) /
    (endTimestampNanos - startTimestampNanos);
  return startFeeFraction + (endFeeFraction - startFeeFraction) * ratio;
}

function feeFractionToPercentNumber(feeFraction: number): number {
  return feeFraction / FEE_FRACTION_SCALE;
}

export function feeReceiverToLabel(receiver: XykFeeReceiver): string {
  return receiver === "Pool" ? "Pool" : receiver.Account;
}

export function hasScheduledFeeAmounts(
  configuration: XykFeeConfiguration,
): boolean {
  return configuration.receivers.some(([, amount]) => {
    if (typeof amount === "number") return false;
    return "Scheduled" in amount;
  });
}

export function evaluateFeeConfigurationAtTimestamp(
  configuration: XykFeeConfiguration,
  timestampNanos = Date.now() * NANOS_PER_MILLISECOND,
): EvaluatedFeeConfigurationEntry[] {
  return normalizeFeeConfigurationEntries(configuration).map((entry) => {
    const evaluatedFeeFraction = evaluateNormalizedFeeAmountAtTimestamp(
      entry.amount,
      timestampNanos,
    );
    if (entry.amount.kind === "scheduled") {
      return {
        receiver: entry.receiver,
        kind: "scheduled",
        feeFraction: evaluatedFeeFraction,
        feePercent: feeFractionToPercentNumber(evaluatedFeeFraction),
        startTimestampNanos: entry.amount.startTimestampNanos,
        endTimestampNanos: entry.amount.endTimestampNanos,
        startFeePercent: feeFractionToPercentNumber(
          entry.amount.startFeeFraction,
        ),
        endFeePercent: feeFractionToPercentNumber(entry.amount.endFeeFraction),
      };
    }

    return {
      receiver: entry.receiver,
      kind: entry.amount.kind,
      feeFraction: evaluatedFeeFraction,
      feePercent: feeFractionToPercentNumber(evaluatedFeeFraction),
    };
  });
}

export function buildStackedScheduledFeeChartPoints(
  configuration: XykFeeConfiguration,
  shouldIncludeReceiver: (receiver: XykFeeReceiver) => boolean = () => true,
): ScheduledFeeChartPoint[] {
  const entries = normalizeFeeConfigurationEntries(configuration).filter(
    (entry) => shouldIncludeReceiver(entry.receiver),
  );
  const scheduledEntries = entries.filter(
    (
      entry,
    ): entry is {
      receiver: XykFeeReceiver;
      amount: Extract<NormalizedFeeAmount, { kind: "scheduled" }>;
    } => entry.amount.kind === "scheduled",
  );
  if (scheduledEntries.length === 0) return [];

  const timestamps = Array.from(
    new Set(
      scheduledEntries.flatMap((entry) => [
        entry.amount.startTimestampNanos,
        entry.amount.endTimestampNanos,
      ]),
    ),
  ).sort((a, b) => a - b);

  return timestamps.map((timestampNanos) => {
    const totalFeeFraction = entries.reduce(
      (sum, entry) =>
        sum +
        evaluateNormalizedFeeAmountAtTimestamp(entry.amount, timestampNanos),
      0,
    );
    return {
      timestampNanos,
      feePercent: feeFractionToPercentNumber(totalFeeFraction),
    };
  });
}
