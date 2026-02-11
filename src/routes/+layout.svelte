<script lang="ts">
  import WalletButton from "../lib/WalletButton.svelte";
  import { BookOpen } from "lucide-svelte";
  import { siX, siTelegram, siGithub } from "simple-icons";
  import { browser } from "$app/environment";
  import { page } from "$app/state";
  import "../app.css";

  if (browser && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js");
  }

  let { children } = $props();

  const isLiquidityPage = $derived(page.url.pathname === "/liquidity");
</script>

<div class="top-bar">
  <nav class="desktop-nav">
    <a href="/" class:active={page.url.pathname === "/"}>Swap</a>
    <a href="/liquidity" class:active={page.url.pathname === "/liquidity"}
      >Liquidity</a
    >
  </nav>
  <WalletButton />
</div>

<main class:wide={isLiquidityPage}>
  <header>
    <h1>Intear <span class="accent">DEX</span></h1>
  </header>

  <nav class="mobile-nav">
    <a href="/" class:active={page.url.pathname === "/"}>Swap</a>
    <a href="/liquidity" class:active={page.url.pathname === "/liquidity"}
      >Liquidity</a
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

  @media (--tablet) {
    .top-bar {
      max-width: 480px;
      justify-content: flex-end;
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
    background: var(--bg-secondary);
    padding: 0.25rem;
    border-radius: 0.75rem;
  }

  .desktop-nav {
    display: flex;
  }

  .mobile-nav {
    display: none;
  }

  @media (--tablet) {
    .desktop-nav {
      display: none;
    }

    .mobile-nav {
      display: flex;
    }

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
