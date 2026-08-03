# Paranoid Devnet Wallet

Paranoid is a disposable, development-only Solana Wallet Standard Chromium extension. It wraps its injected provider with the Wallet Standard adapter based on Anza's Ghost reference implementation.

## Safety

- The extension is hard-coded to Solana devnet.
- It generates one disposable key and stores it **unencrypted** in `chrome.storage.local`.
- Never send mainnet SOL, real tokens, or a valuable seed phrase to this wallet.
- Transaction approvals show program IDs and instruction counts, not a complete human-readable simulation.

## Build and load in a Chromium browser

```sh
bun install
bun run build
```

Then:

1. Open Chrome, Helium, Brave, Edge, or another Chromium-based browser and navigate to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository's `dist` directory.
5. Pin **Paranoid Devnet Wallet** and click its icon to see the generated address.

The build uses the standard Manifest V3 format and contains no browser-specific integration.

Run `bun run build` and click the extension's reload button on `chrome://extensions` after code changes. Reload any dapp tab as well because the provider is injected at page load.

## Test

Open a Solana dapp that supports Wallet Standard and choose **Paranoid**. Approvals are displayed in extension-owned popup windows. `signAndSendTransaction` simulates the signed transaction against devnet before broadcasting it.

The legacy provider is also available as `window.paranoid` for local debugging, but dapps should discover the wallet through Wallet Standard.

## Build outputs

`bun run build` compiles the reusable adapter to `lib` and the loadable Chrome extension to `dist`. Use `bun run build:extension` to rebuild only the extension.
