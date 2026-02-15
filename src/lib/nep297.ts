export const NEP297_EVENT_JSON_PREFIX = "EVENT_JSON:";

export function parseNep297FromLog<T = unknown>(log: unknown): T | null {
  if (typeof log !== "string" || !log.startsWith(NEP297_EVENT_JSON_PREFIX)) {
    return null;
  }

  try {
    return JSON.parse(log.slice(NEP297_EVENT_JSON_PREFIX.length)) as T;
  } catch {
    return null;
  }
}
