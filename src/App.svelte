<script lang="ts">
  import SwapForm from './lib/SwapForm.svelte'
  import WalletButton from './lib/WalletButton.svelte'

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

  @media (max-width: 640px) {
    .top-bar {
      top: 1rem;
      right: 1rem;
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
  }
</style>
