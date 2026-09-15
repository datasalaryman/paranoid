# Paranoid Wallet

<img src="docs/assets/the-scream.jpg" alt="The Scream by Edvard Munch" width="400">

Paranoid is an encrypted Solana development wallet for Chromium browsers. It implements Wallet Standard and supports built-in development and test clusters, custom RPC endpoints, and RPC-free signing.

> [!WARNING]
> Paranoid is built for development and debugging, not for protecting valuable assets. Use dedicated development keypairs, inspect the selected cluster and RPC before signing, and never import a seed phrase or keypair that controls real assets. This applies to Mainnet as well as test clusters.

## Current capabilities

- Connect to dapps through Wallet Standard as **Paranoid**.
- Select Devnet, Testnet, Localnet, a custom RPC, or Sign Only mode.
- Import and switch between multiple keypairs.
- Review and approve message signing, individual transactions, and transaction batches in extension-owned windows.
- Sign legacy, V0, and V1 transactions while preserving existing co-signatures.
- Simulate transactions and show SOL balance changes, programs, instructions, inner instructions, and transaction messages before approval when an RPC is selected.
- Save signing requests for later review, blockhash refresh, signing, and submission.
- Send SOL from the extension and browse address transaction history.
- Open cluster-aware Solana Explorer links for addresses, signatures, token accounts, and programs.
- Use the legacy `window.paranoid` provider when testing integrations that do not use Wallet Standard.

Paranoid does not choose a default cluster. After importing the first keypair, you must select an RPC profile or Sign Only mode. The active cluster and RPC can be changed later from the account menu.

## Clusters and RPCs

The built-in profiles are:

| Profile   | Wallet Standard chain      | Endpoint                         |
| --------- | -------------------------- | -------------------------------- |
| Devnet    | `solana:devnet`            | `https://api.devnet.solana.com`  |
| Testnet   | `solana:testnet`           | `https://api.testnet.solana.com` |
| Localnet  | `solana:localnet`          | `http://127.0.0.1:8899`          |
| Sign Only | Any requested Solana chain | No endpoint                      |

Custom HTTP or HTTPS RPC endpoints can be added, renamed, edited, selected, and removed. Mainnet is supported through a custom RPC rather than a built-in profile. Paranoid calls `getGenesisHash` when an endpoint is added and before wallet-side submission. Known genesis hashes are identified as Mainnet, Devnet, or Testnet. Unknown custom networks are exposed as `solana:mainnet`, while the built-in Localnet profile remains `solana:localnet`.

The selected RPC receives balance, simulation, history, and submission requests and can observe that activity. Custom RPC access requires an optional browser host permission. Custom RPC URLs are encrypted in the wallet vault.

### Sign Only

Sign Only mode performs no RPC requests. It can sign messages and transactions for any Solana cluster, but it cannot:

- verify the requested cluster against an endpoint;
- simulate or broadcast transactions;
- display balances or transaction history;
- send SOL from the extension; or
- save transactions for later wallet-side submission.

## Keypairs and vault

Paranoid does not generate a keypair. Create a dedicated development keypair separately, then import either:

- a valid 12-word or 24-word English BIP-39 seed phrase; or
- a 64-byte Solana CLI keypair JSON file.

Mnemonic import uses the first 32 bytes of the BIP-39 seed, matching the default `solana-keygen` keypair derivation. Paranoid does not support BIP-39 passphrases, derivation-path selection, hardware wallets, private-key export, or key generation.

Before the first import, Paranoid requires a password of at least eight characters. Keypairs and custom RPC URLs are encrypted with AES-256-GCM. The encryption key is derived with PBKDF2-HMAC-SHA-256 using a random salt and 600,000 iterations. Encrypted records are stored in IndexedDB, and the unlocked vault key is kept in browser session storage so the extension worker can restart without immediately locking the wallet.

The vault locks after five minutes without wallet activity. There is no password recovery or password-change flow.

Saved transaction payloads, transaction-history cache entries, keypair labels and public keys, RPC labels and cluster metadata, and trusted site origins are not encrypted. Treat the browser profile as development data.

## Dapp integration

Wallet Standard applications should discover **Paranoid** through the standard registry. The wallet advertises Mainnet, Devnet, Testnet, and Localnet and implements:

- `standard:connect`
- `standard:disconnect`
- `standard:events`
- `solana:signMessage`
- `solana:signTransaction`
- `solana:signAndSendTransaction`

The injected legacy provider is available as `window.paranoid` and supports `connect`, `disconnect`, `signMessage`, `signTransaction`, `signAllTransactions`, and `signAndSendTransaction`. It does not replace `window.solana` or emulate Phantom.

Connecting grants trust to the requesting origin. Every signing request still requires a separate approval. Changing the active keypair does not currently notify an already connected page, so reload or reconnect the dapp after switching accounts.

## Transaction behavior

With an RPC selected, Paranoid checks that a dapp's requested chain matches the active RPC. Single transactions are simulated before approval. Batch transactions are reviewed but are not simulated individually because later transactions may depend on earlier transactions in the batch.

- `signTransaction` and `signAllTransactions` return signed transaction bytes to the dapp.
- `signAndSendTransaction` signs and submits through the selected RPC.
- Saved requests are scoped to the active public key and RPC.
- Signing a saved request simulates it with signature verification and submits it through that request's RPC.
- Successful submission removes unpinned saved requests; pinned requests remain available.
- Refreshing a saved transaction's blockhash clears all signatures because the message changes.

The transaction review decodes common System Program and SPL Token instructions and displays other programs and instruction data without claiming to provide a complete human-readable interpretation. Always inspect unfamiliar transactions independently.

## Build and load

Requirements:

- Node.js 22 or newer
- Bun
- A Chromium-based browser

Install dependencies and build the reusable adapter and extension:

```sh
bun install
bun run build
```

Then open `chrome://extensions`:

1. Enable **Developer mode**.
2. Click **Load unpacked**.
3. Select this repository's `.output/chrome-mv3` directory.
4. Pin **Paranoid Wallet**.

Run WXT in development mode with:

```sh
bun run dev
```

After rebuilding or reloading the extension, reload open dapp tabs because the provider is injected at page load.

## Development

Useful commands:

```sh
bun test
bun run tsc
bun run typecheck:extension
bun run build:extension
bun run build
```

The automated RPC tests use mocks and do not submit transactions to a live cluster.

## Artwork attribution

The wallet icon and README image are derived from Edvard Munch's _The Scream_ (also titled _The Scream of Nature_), 1893, tempera and wax crayon on board, 91 x 73.5 cm. The painting is held by the National Museum of Art, Architecture and Design, Oslo, Norway, accession number NG.M.00939.

The digital reproduction was sourced from the [Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:Edvard_Munch_-_The_Scream.jpg), which identifies its source as the [National Museum of Norway](https://www.nasjonalmuseet.no/en/collection/object/NG.M.00939). This repository includes a resized and recompressed reproduction at `docs/assets/the-scream.jpg`, a square crop at `docs/assets/the-scream-icon.png`, and resized icon derivatives under `public/icons`.

Munch died in 1944. Wikimedia Commons marks this work as public domain in the United States because it was published before January 1, 1931, and as public domain in its country of origin and other countries and areas where copyright lasts for the author's life plus 70 years or fewer. Commons also notes that copyright terms can be longer in some jurisdictions. The file is identified as free of known copyright restrictions, including related and neighboring rights, under the [Creative Commons Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/).
