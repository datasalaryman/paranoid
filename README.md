# Paranoid Devnet Wallet

<img src="docs/assets/the-scream.jpg" alt="The Scream by Edvard Munch" width="400">

Paranoid is a disposable, development-only Solana Wallet Standard Chromium extension.

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
4. Select this repository's `.output/chrome-mv3` directory.
5. Pin **Paranoid Devnet Wallet** and click its icon to see the generated address.

The build uses the standard Manifest V3 format and contains no browser-specific integration.

Run `bun run dev` for WXT development mode, or run `bun run build` and click the extension's reload button on `chrome://extensions` after code changes. Reload any dapp tab as well because the provider is injected at page load.

## Test

Open a Solana dapp that supports Wallet Standard and choose **Paranoid**. Approvals are displayed in extension-owned popup windows. `signAndSendTransaction` simulates the signed transaction against devnet before broadcasting it.

The legacy provider is also available as `window.paranoid` for local debugging, but dapps should discover the wallet through Wallet Standard.

### Fresh requests versus saved transactions

- Fresh `signTransaction` and `signAllTransactions` requests return signed transactions to the dapp
  for submission. This applies in Sign Only mode and when a cluster/custom RPC is selected.
- Fresh `signAndSendTransaction` requests are submitted by the wallet using the selected RPC.
- Once saved, **Sign & Send** signs, simulates with signature verification, and submits through that
  saved request's cluster/custom RPC, regardless of which signing method the dapp originally used.
  Successful submission removes unpinned requests; failures keep them available for retry.
- Sign Only mode returns signatures to the dapp and does not offer saving or wallet-side submission.

## Build outputs

`bun run build` compiles the reusable adapter to `lib` and uses WXT to emit the loadable Chrome extension to `.output/chrome-mv3`. Use `bun run build:extension` to rebuild only the extension.

## Custom RPC networks

Custom RPCs use `getGenesisHash` to recognize mainnet, devnet, and testnet. An unrecognized genesis
hash (for example, a mainnet fork) defaults to **`solana:mainnet`**. The built-in **Localnet** profile
defaults to `solana:localnet` for local validators.

Existing custom entries saved with the old `solana:localnet` fallback are exposed as mainnet
automatically. Their encrypted URLs, RPC IDs, and saved transactions are preserved. The Explorer
Mainnet setting controls explorer links separately from the RPC's Wallet Standard chain label.

## V1 transactions

The Wallet Standard `solana:signTransaction` and `solana:signAndSendTransaction` features advertise
`['legacy', 0, 1]`. V1 transactions support up to 4096 bytes. Kit handles V1 wire encoding and signing;
`@solana/web3.js` 1.99+ handles RPC reads and the existing legacy/V0 provider API. The 1.x SDK alone
cannot serialize or sign V1 transactions.

- Single and batch approvals show V1 compute units, loaded-account data limits, heap size, and the
  **total priority fee in lamports** from message config. ComputeBudget instructions are no-ops in V1.
- With an RPC selected, **Save for Later** is available for single requests and batches, including
  mixed V0/V1 batches. Saving a batch stores every transaction as an individual signing request in
  the original order, without signing any of them. Batch requests are not simulated in isolation;
  each saved transaction is simulated when opened for review.
- Saved V1 requests support the same review, message copying, pin/unpin, reorder, blockhash refresh,
  sign/send, retry, and removal actions as V0. Their resource limits and fees remain visible during
  saved-transaction review. Sign Only mode has the same no-saving restriction for both versions.
- Co-signing preserves the original message and other signatures. Refreshing a saved V1 transaction's
  blockhash clears every signature, since all signers must sign the new message.
- Simulations and broadcasts use base64, and transaction-history reads opt in with
  `maxSupportedTransactionVersion: 1`.
- Dapps must explicitly set V1 compute-unit and loaded-account data limits (both default to zero),
  use inline accounts rather than lookup tables, and check the wallet's advertised versions before
  submitting V1. Paranoid signs the supplied config without rewriting it. The wallet's built-in SOL
  transfer continues to build legacy transactions; larger transactions are opt-in.

After rebuilding, reload the extension and the dapp tab to pick up the new version advertisement.
Custom RPCs need Agave 4.2.2+ for correct V1 reads. For local end-to-end testing, use a V1-enabled
validator (Solana CLI 4.2+, with Agave 4.2.2+ for reads) or Surfpool 1.5+.

The injected provider returns signed transaction objects using the caller's SDK class, preserving
its message methods. It accepts both synchronous legacy serializers (web3.js 1.x) and asynchronous
ones (web3.js 3.x). A V1 dapp must itself use Kit 8+ or web3.js 3.0.0-rc.3+ to build, simulate, and
send V1 transactions; web3.js 1.99's V1 support is read-only even when the wallet supports signing.

Run `bun test` for signing, co-signing, approval, malformed-payload, size-boundary, and mocked RPC
regressions. These tests do not submit transactions to a live cluster.

Reference: [Solana's larger transaction sizes migration guide](https://solana.com/upgrades/larger-transaction-sizes).

## Artwork attribution

The wallet icon and README image are derived from Edvard Munch's _The Scream_ (also titled _The
Scream of Nature_), 1893, tempera and wax crayon on board, 91 x 73.5 cm. The painting is held by the
National Museum of Art, Architecture and Design, Oslo, Norway, accession number NG.M.00939.

The digital reproduction was sourced from the [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Edvard_Munch_-_The_Scream.jpg),
which identifies its source as the [National Museum of Norway](https://www.nasjonalmuseet.no/en/collection/object/NG.M.00939).
This repository includes a resized and recompressed reproduction at `docs/assets/the-scream.jpg`, a
square crop at `docs/assets/the-scream-icon.png`, and resized icon derivatives under `public/icons`.

Munch died in 1944. Wikimedia Commons marks this work as public domain in the United States because
it was published before January 1, 1931, and as public domain in its country of origin and other
countries and areas where copyright lasts for the author's life plus 70 years or fewer. Commons also
notes that copyright terms can be longer in some jurisdictions. The file is identified as free of
known copyright restrictions, including related and neighboring rights, under the [Creative Commons
Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/).
