export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "intear-dex-theme";
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: "#0a0e17",
  light: "#f4f7fb",
};

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function getSystemResolvedTheme(): ResolvedTheme {
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function setThemeMetaColor(theme: ResolvedTheme): void {
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (!metaThemeColor) return;
  metaThemeColor.setAttribute("content", THEME_COLORS[theme]);
}

export function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

export function persistThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {}
}

export function resolveTheme(
  preference: ThemePreference,
  systemTheme: ResolvedTheme = getSystemResolvedTheme(),
): ResolvedTheme {
  return preference === "system" ? systemTheme : preference;
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  setThemeMetaColor(theme);
}

export function applyThemePreference(
  preference: ThemePreference,
  systemTheme: ResolvedTheme = getSystemResolvedTheme(),
): ResolvedTheme {
  const resolvedTheme = resolveTheme(preference, systemTheme);
  applyResolvedTheme(resolvedTheme);
  return resolvedTheme;
}

export function initializeTheme(): {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
} {
  const preference = readThemePreference();
  const resolvedTheme = applyThemePreference(preference);
  return { preference, resolvedTheme };
}

export function onSystemThemeChange(
  onChange: (systemTheme: ResolvedTheme) => void,
): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (event: MediaQueryListEvent) => {
    onChange(event.matches ? "dark" : "light");
  };

  query.addEventListener("change", handler);
  return () => {
    query.removeEventListener("change", handler);
  };
}
