<script lang="ts">
  import { onMount } from "svelte";
  import WalletButton from "../lib/WalletButton.svelte";
  import { BookOpen, Moon, Sun, Monitor } from "lucide-svelte";
  import { siX, siTelegram, siGithub } from "simple-icons";
  import { page } from "$app/state";
  import { tokenHubStore } from "../lib/tokenHubStore";
  import {
    applyThemePreference,
    initializeTheme,
    onSystemThemeChange,
    persistThemePreference,
    type ResolvedTheme,
    type ThemePreference,
  } from "../lib/theme";

  // if ("serviceWorker" in navigator) {
  //   navigator.serviceWorker.register("/sw.js");
  // }

  tokenHubStore.init();
  tokenHubStore.start();

  let { children } = $props();

  const isWidePage = $derived(
    page.url.pathname === "/pools" ||
      page.url.pathname === "/pool" ||
      page.url.pathname === "/stats" ||
      page.url.pathname === "/launch",
  );
  const productLabel = $derived(
    page.url.pathname === "/launch" ? "Launch" : "DEX",
  );

  let themePreference = $state<ThemePreference>("system");
  let resolvedTheme = $state<ResolvedTheme>("dark");

  const themeButtonLabel = $derived.by(() => {
    const currentLabel =
      themePreference === "system"
        ? `System (${resolvedTheme})`
        : resolvedTheme === "dark"
          ? "Dark"
          : "Light";
    const nextPreference =
      themePreference === "system"
        ? "light"
        : themePreference === "light"
          ? "dark"
          : "system";
    return `Theme: ${currentLabel}. Switch to ${nextPreference}.`;
  });

  onMount(() => {
    const initializedTheme = initializeTheme();
    themePreference = initializedTheme.preference;
    resolvedTheme = initializedTheme.resolvedTheme;

    return onSystemThemeChange((systemTheme) => {
      if (themePreference !== "system") return;
      resolvedTheme = applyThemePreference("system", systemTheme);
    });
  });

  function cycleThemePreference(): void {
    const nextPreference: ThemePreference =
      themePreference === "system"
        ? "light"
        : themePreference === "light"
          ? "dark"
          : "system";

    themePreference = nextPreference;
    persistThemePreference(nextPreference);
    resolvedTheme = applyThemePreference(nextPreference);
  }
</script>

<div class="top-bar">
  <nav class="desktop-nav">
    <a
      href="/"
      class:active={page.url.pathname === "/"}
      aria-current={page.url.pathname === "/" ? "page" : undefined}>Swap</a
    >
    <a
      href="/pools"
      class:active={page.url.pathname === "/pools"}
      aria-current={page.url.pathname === "/pools" ? "page" : undefined}
      >Pools</a
    >
    <a
      href="/stats"
      class:active={page.url.pathname === "/stats"}
      aria-current={page.url.pathname === "/stats" ? "page" : undefined}
      >Stats</a
    >
    <a
      href="/launch"
      class:active={page.url.pathname === "/launch"}
      aria-current={page.url.pathname === "/launch" ? "page" : undefined}
      >Launch</a
    >
  </nav>
  <div class="top-bar-controls">
    <button
      type="button"
      class="theme-toggle"
      data-current-theme={resolvedTheme}
      data-theme-preference={themePreference}
      aria-label={themeButtonLabel}
      title={themeButtonLabel}
      onclick={cycleThemePreference}
    >
      {#if themePreference === "system"}
        <Monitor size={18} />
      {:else if resolvedTheme === "dark"}
        <Moon size={18} />
      {:else}
        <Sun size={18} />
      {/if}
    </button>
    <WalletButton />
  </div>
</div>

<main class:wide={isWidePage}>
  <header>
    <h1>Intear <span class="accent">{productLabel}</span></h1>
  </header>

  <nav class="mobile-nav">
    <a
      href="/"
      class:active={page.url.pathname === "/"}
      aria-current={page.url.pathname === "/" ? "page" : undefined}>Swap</a
    >
    <a
      href="/pools"
      class:active={page.url.pathname === "/pools"}
      aria-current={page.url.pathname === "/pools" ? "page" : undefined}
      >Pools</a
    >
    <a
      href="/stats"
      class:active={page.url.pathname === "/stats"}
      aria-current={page.url.pathname === "/stats" ? "page" : undefined}
      >Stats</a
    >
    <a
      href="/launch"
      class:active={page.url.pathname === "/launch"}
      aria-current={page.url.pathname === "/launch" ? "page" : undefined}
      >Launch</a
    >
  </nav>

  {@render children()}
</main>

<footer>
  <div class="footer-links">
    <a
      href="https://x.com/intea_rs"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="X"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
      >
        <path d={siX.path} />
      </svg>
    </a>
    <a
      href="https://t.me/intearchat"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Telegram"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
      >
        <path d={siTelegram.path} />
      </svg>
    </a>
    <a
      href="https://github.com/INTEARnear/dex-frontend"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="GitHub"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
      >
        <path d={siGithub.path} />
      </svg>
    </a>
    <a
      href="https://docs.intear.tech/docs/dex-aggregator"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Documentation"
    >
      <BookOpen size={20} />
    </a>
  </div>
</footer>

<style>
  main {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    width: 100%;
    max-width: 480px;
    position: relative;
  }

  main.wide {
    max-width: 1400px;
    flex: 1;
    justify-content: flex-start;
  }

  .top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    max-width: 900px;
    padding-top: env(safe-area-inset-top, 0px);
  }

  .top-bar-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .theme-toggle {
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .theme-toggle[data-current-theme="dark"] {
    color: var(--accent-primary);
  }

  .theme-toggle[data-current-theme="light"] {
    color: var(--status-warning-text);
  }

  .theme-toggle[data-theme-preference="system"] {
    color: var(--text-secondary);
  }

  .theme-toggle:hover {
    background: var(--bg-input);
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }

  .theme-toggle:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 2px;
  }

  @media (--tablet) {
    .top-bar {
      max-width: 480px;
      justify-content: flex-end;
    }

    .top-bar-controls {
      gap: 0.5rem;
    }

    .theme-toggle {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 0.625rem;
    }
  }

  header {
    text-align: center;
    margin-top: 0;
  }

  h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.02em;
  }

  .accent {
    color: var(--accent-primary);
  }

  nav {
    display: flex;
    gap: 0.5rem;
    padding: 0.25rem;
    border-radius: 0.75rem;
  }

  .desktop-nav {
    display: flex;
  }

  .mobile-nav {
    display: none;
  }

  @media (max-width: 860px) {
    .mobile-nav {
      display: flex;
    }
    .desktop-nav {
      display: none;
    }
  }

  @media (--tablet) {
    main {
      gap: 1rem;
    }
  }

  nav a {
    padding: 0.5rem 1.25rem;
    border-radius: 0.5rem;
    color: var(--text-secondary);
    text-decoration: none;
    font-weight: 500;
    font-size: 0.875rem;
    transition: all 0.2s ease;
  }

  nav a:hover {
    color: var(--text-primary);
  }

  nav a.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  footer {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .footer-links {
    display: flex;
    gap: 1.5rem;
    align-items: center;
  }

  .footer-links a {
    color: var(--text-secondary);
    transition: color 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .footer-links a:hover {
    color: var(--accent-primary);
  }

  @media (--tablet) {
    .footer-links {
      gap: 1.25rem;
    }
  }

  @media (--mobile) {
    main {
      gap: 0.75rem;
    }

    header {
      gap: 0;
      margin-top: 0;
    }

    h1 {
      font-size: 1.75rem;
    }

    nav a {
      padding: 0.5rem 1rem;
      font-size: 0.8125rem;
    }

    .footer-links {
      gap: 1rem;
    }

    .theme-toggle {
      width: 2rem;
      height: 2rem;
    }
  }

  @media (--small-mobile) {
    .theme-toggle {
      width: 1.875rem;
      height: 1.875rem;
    }

    nav a {
      padding: 0.375rem 0.75rem;
      font-size: 0.8125rem;
      font-size: 0.75rem;
    }
  }

  @media (--short-screen) {
    main {
      gap: 0.5rem;
    }
  }

  @media (--landscape-mobile) {
    main {
      gap: 0.75rem;
    }

    header {
      display: none;
    }
  }
</style>
