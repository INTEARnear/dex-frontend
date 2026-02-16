import { writable } from "svelte/store";

export const activeFloatingTooltipId = writable<number | null>(null);
export const activeMobileTooltipId = writable<number | null>(null);

let nextTooltipId = 1;

export function createTooltipId(): number {
  return nextTooltipId++;
}
