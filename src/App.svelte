<script lang="ts">
  import SwapForm from "./lib/SwapForm.svelte";
  import WalletButton from "./lib/WalletButton.svelte";
  import { BookOpen } from "lucide-svelte";
  import { siX, siTelegram, siGithub } from "simple-icons";

  const phrases = [
    "Swap tokens instantly",
    "Swap in tears",
    "Best rates across all DEXes",
    "Swap with fastest DEX router",
    "Have you tried Intear Wallet?",
    "Trade even faster in Bettear Bot",
    "Trade at the speed of Internet",
  ];

  const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
</script>

<div class="top-bar">
  <WalletButton />
</div>

<main>
  <header>
    <h1>Intear <span class="accent">DEX</span></h1>
    <p class="subtitle">{randomPhrase}</p>
  </header>

  <SwapForm />
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
    gap: 2rem;
    width: 100%;
    max-width: 480px;
    position: relative;
  }

  .top-bar {
    position: fixed;
    top: 2rem;
    right: 2rem;
    z-index: 100;
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

  .subtitle {
    margin: 0.5rem 0 0;
    color: var(--text-secondary);
    font-size: 1rem;
    font-weight: 400;
  }

  footer {
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
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

  @media (max-width: 640px) {
    .top-bar {
      top: 1rem;
      right: 1rem;
    }

    footer {
      bottom: 1rem;
    }

    .footer-links {
      gap: 1.25rem;
    }
  }

  @media (max-width: 480px) {
    .top-bar {
      position: fixed;
      top: 0.75rem;
      right: 0.75rem;
      left: 0.75rem;
      display: flex;
      justify-content: flex-end;
    }

    header {
      gap: 0;
      margin-top: 3rem;
    }

    h1 {
      font-size: 1.75rem;
    }

    .subtitle {
      font-size: 0.875rem;
      margin-top: 0.25rem;
    }

    footer {
      bottom: 0.75rem;
    }

    .footer-links {
      gap: 1rem;
    }
  }
</style>
