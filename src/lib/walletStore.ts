import { writable } from "svelte/store";
import { NearConnector } from "@hot-labs/near-connect";
import type { NearWalletBase } from "@hot-labs/near-connect";

interface WalletState {
  isConnected: boolean;
  accountId: string | null;
  wallet: NearWalletBase | null;
}

function createWalletStore() {
  const { subscribe, set, update } = writable<WalletState>({
    isConnected: false,
    accountId: null,
    wallet: null,
  });

  const connector = new NearConnector({
    footerBranding: {
      icon: "https://dex.intea.rs/intear-logo.svg",
      heading: "NEAR Connect",
      link: "https://wallet.intear.tech",
      linkText: "Don't have a wallet?",
    },
    manifest: JSON.parse(`{
      "version": "1.1.0",
      "wallets": [
        {
          "id": "intear-wallet",
          "name": "Intear Wallet",
          "icon": "https://wallet.intear.tech/favicon.svg",
          "description": "A fast and secure wallet for everyday interactions with dapps",
          "website": "tip://Recommended",
          "version": "1.0.0",
          "executor": "https://wallet.intear.tech/near-selector.js",
          "type": "sandbox",
          "features": {
            "signMessage": true,
            "signTransaction": false,
            "signAndSendTransaction": true,
            "signAndSendTransactions": true,
            "signInWithoutAddKey": true,
            "verifyOwner": false,
            "testnet": true
          },
          "platform": {
            "web": "https://wallet.intear.tech"
          },
          "permissions": {
            "storage": true,
            "location": true,
            "allowsOpen": [
              "https://wallet.intear.tech",
              "https://staging.wallet.intear.tech",
              "http://intearwallet.local",
              "https://intearwallet.local",
              "http://intearwallet.localhost:3000",
              "intear://",
              "https://logout-bridge-service.intear.tech"
            ]
          }
        },
        {
          "id": "hot-wallet",
          "name": "HOT Wallet",
          "icon": "https://app.hot-labs.org/images/hot/hot-icon.png",
          "description": "Secure Multichain wallet. Manage assets, refuel gas, and mine $HOT on any device with HOT Wallet",
          "version": "1.0.0",
          "executor": "https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/hotwallet.js",
          "type": "sandbox",

          "platform": {
            "android": "https://play.google.com/store/apps/details?id=app.herewallet.hot&hl=en",
            "ios": "https://apps.apple.com/us/app/hot-wallet/id6740916148",
            "chrome": "https://chromewebstore.google.com/detail/hot-wallet/mpeengabcnhhjjgleiodimegnkpcenbk",
            "firefox": "https://addons.mozilla.org/en-US/firefox/addon/hot-wallet",
            "tga": "https://t.me/hot_wallet/app"
          },

          "features": {
            "signMessage": true,
            "signInWithoutAddKey": true,
            "signAndSendTransaction": true,
            "signAndSendTransactions": true
          },

          "permissions": {
            "storage": true,
            "allowsOpen": [
              "https://download.hot-labs.org",
              "https://hot-labs.org/wallet",
              "https://t.me/hot_wallet/app",
              "https://play.google.com",
              "https://apps.apple.com",
              "hotwallet://"
            ]
          }
        },
        {
          "id": "meteor-wallet",
          "name": "Meteor Wallet",
          "icon": "https://raw.githubusercontent.com/Meteor-Wallet/meteor_wallet_sdk/main/assets/meteor-logo-svg.svg",
          "description": "The most simple and secure wallet to manage your crypto, access DeFi, and explore Web3",
          "version": "1.1.0",
          "executor": "https://raw.githubusercontent.com/Meteor-Wallet/meteor_wallet_sdk/data-storage/storage/meteor-near-connect-latest.js",
          "type": "sandbox",

          "features": {
            "signMessage": true,
            "signInWithoutAddKey": true,
            "signAndSendTransaction": true,
            "signAndSendTransactions": true,
            "signDelegateActions": true,
            "mainnet": true,
            "testnet": true
          },

          "platform": {
            "web": "https://wallet.meteorwallet.app",
            "chrome": "https://chromewebstore.google.com/detail/meteor-wallet/pcndjhkinnkaohffealmlmhaepkpmgkb"
          },

          "permissions": {
            "storage": true,
            "allowsOpen": [
              "https://chromewebstore.google.com",
              "https://wallet.meteorwallet.app",
              "https://meteorwallet.app"
            ],
            "external": ["meteorCom", "meteorComV2"]
          }
        },
        {
          "id": "mynearwallet",
          "name": "MyNearWallet",
          "icon": "https://storage.herewallet.app/upload/d0544304123d10518af961a15d5722ff1cef7abf62155f830e6d733e41f7da4b.png",
          "description": "Web wallet for NEAR.",
          "version": "1.0.0",
          "executor": "https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/mnw.js",
          "type": "sandbox",

          "platform": {
            "web": "https://app.mynearwallet.com"
          },

          "features": {
            "signMessage": true,
            "signInWithoutAddKey": true,
            "signAndSendTransaction": true,
            "signAndSendTransactions": true
          },

          "permissions": {
            "storage": true,
            "allowsOpen": ["https://app.mynearwallet.com"]
          }
        },
        {
          "id": "okx-wallet",
          "name": "OKX Wallet",
          "icon": "https://storage.herewallet.app/upload/cd4ada38f27715b92602fb5f723c2580d7935e5b815b81169cd21b9ead683bfb.svg",
          "description": "OKX Wallet is a secure and easy-to-use wallet for the OKX ecosystem",
          "version": "1.0.0",
          "executor": "https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/okx.js",
          "type": "sandbox",
          "platform": {
            "web": "https://www.okx.com",
            "chrome": "https://chromewebstore.google.com/detail/okx-wallet/mcohilncbfahbmgdjkbpemcciiolgcge",
            "edge": "https://microsoftedge.microsoft.com/addons/detail/okx-wallet/pbpjkcldjiffchgbbndmhojiacbgflha",
            "ios": "https://apps.apple.com/us/app/okx-wallet/id6463797825"
          },
          "permissions": {
            "storage": true,
            "external": ["okxwallet.near"],
            "allowsOpen": [
              "https://www.okx.com",
              "https://apps.apple.com/us/app/okx-wallet",
              "https://microsoftedge.microsoft.com/addons/detail/okx-wallet",
              "https://chromewebstore.google.com/detail/okx-wallet"
            ]
          },
          "features": {
            "signMessage": true,
            "signInWithoutAddKey": true,
            "signAndSendTransaction": true,
            "signAndSendTransactions": true
          }
        },
        {
          "id": "near-mobile",
          "name": "NEAR Mobile",
          "icon": "https://storage.herewallet.app/upload/179839f01189bc54afea2fd34eb092ddb6d63c97b5c8c9e418317285fd751f0c.webp",
          "description": "Discover the only NEAR wallet you will need: NEAR Mobile, the most secure and comprehensive mobile wallet designed exclusively for the NEAR Blockchain",
          "executor": "https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/near-mobile.js",
          "type": "sandbox",
          "version": "1.0.0",

          "features": {
            "signMessage": true,
            "signInWithoutAddKey": true,
            "signAndSendTransaction": true,
            "signAndSendTransactions": true,
            "testnet": true
          },

          "platform": {
            "android": "https://play.google.com/store/apps/details?id=com.peersyst.nearmobilewallet",
            "ios": "https://apps.apple.com/us/app/near-mobile-crypto-wallet/id6443501225"
          },

          "permissions": {
            "storage": true,
            "allowsOpen": ["https://nearmobile.app", "https://play.google.com", "https://apps.apple.com"]
          }
        },
        {
          "id": "nightly-wallet",
          "name": "Nightly Wallet",
          "icon": "https://storage.herewallet.app/upload/6947eb5c14c65a715fb49a08e5937dcecc994bf224b3869b9878bd7a7db068f9.webp",
          "description": "Surf through the multichain Metaverse with Nightly",
          "version": "1.0.0",
          "executor": "https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/nightly.js",
          "type": "sandbox",
          "platform": {
            "chrome": "https://chromewebstore.google.com/detail/nightly/fiikommddbeccaoicoejoniammnalkfa"
          },
          "permissions": {
            "storage": true,
            "external": ["nightly.near"],
            "allowsOpen": ["https://nightly.app", "https://chromewebstore.google.com/detail/nightly/fiikommddbeccaoicoejoniammnalkfa"]
          },
          "features": {
            "signMessage": true,
            "signInWithoutAddKey": true,
            "signAndSendTransaction": true,
            "signAndSendTransactions": true,
            "testnet": true
          }
        },
        {
          "id": "wallet-connect",
          "name": "Wallet Connect",
          "icon": "https://storage.herewallet.app/upload/2470b14a81fcf84e7cb53230311a7289b96a49ab880c7fa7a22765d7cdeb1271.svg",
          "description": "Wallet Connect is a protocol for connecting wallets to dapps.",
          "version": "1.0.0",
          "executor": "https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/wallet-connect.js",
          "type": "sandbox",
          "platform": {},
          "permissions": {
            "storage": true,
            "clipboardWrite": true,
            "walletConnect": true
          },
          "features": {
            "signMessage": true,
            "signInWithoutAddKey": true,
            "signAndSendTransaction": true,
            "signAndSendTransactions": true,
            "testnet": true
          }
        },
        {
          "id": "unity-wallet",
          "name": "Unity Wallet",
          "icon": "https://storage.herewallet.app/upload/e596491a4fcd2d352ffff15bfe4a3fc6c0d0ed29ac9d43edc7501d20d9b667bc.png",
          "description": "Discover the most secure, feature-packed, self-custodial crypto and Web3 wallet. Unlock limitless possibilities.",
          "version": "1.0.0",
          "executor": "https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/wallet-connect.js",
          "type": "sandbox",
          "platform": {
            "web": "https://unitywallet.com",
            "android": "https://unitywallet.oneclick.me",
            "ios": "https://unitywallet.oneclick.me"
          },
          "permissions": {
            "storage": true,
            "clipboardWrite": true,
            "walletConnect": true
          },
          "features": {
            "signMessage": true,
            "signInWithoutAddKey": true,
            "signAndSendTransaction": true,
            "signAndSendTransactions": true,
            "testnet": true
          }
        }
      ]
    }`),
  });

  connector.on("wallet:signIn", async (event) => {
    if (!event.accounts || event.accounts.length === 0) {
      set({
        isConnected: false,
        accountId: null,
        wallet: null,
      });
      return;
    }
    const wallet = await connector.wallet();
    update(() => ({
      isConnected: true,
      accountId: event.accounts[0].accountId,
      wallet,
    }));
  });

  connector.on("wallet:signOut", async () => {
    set({
      isConnected: false,
      accountId: null,
      wallet: null,
    });
  });

  // Check if already connected on init
  async function checkConnection() {
    try {
      const wallet = await connector.wallet();
      const accounts = await wallet.getAccounts();
      if (accounts.length > 0) {
        update(() => ({
          isConnected: true,
          accountId: accounts[0].accountId,
          wallet,
        }));
      }
    } catch (error) {
      // Not connected
      console.log("No wallet connected");
    }
  }

  checkConnection();

  return {
    subscribe,
    connect: async () => {
      try {
        await connector.connect();
      } catch (error) {
        console.error("Failed to connect wallet:", error);
        throw error;
      }
    },
    disconnect: async () => {
      try {
        await connector.disconnect();
      } catch (error) {
        console.error("Failed to disconnect wallet:", error);
        throw error;
      }
    },
    getConnector: () => connector,
  };
}

export const walletStore = createWalletStore();
