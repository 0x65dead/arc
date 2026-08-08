# Connecting a wallet

Arc Names runs on Arc Testnet. Your wallet needs to know that network exists, and it needs some
gas to spend.

## Network details

| Field | Value |
| --- | --- |
| Network name | Arc Testnet |
| Chain ID | `5042002` (`0x4cef52` in hex) |
| Currency symbol | USDC |
| Currency decimals | **18** |
| Block explorer | [https://testnet.arcscan.app](https://testnet.arcscan.app) |
| RPC URL | See [below](#rpc-endpoints) |

::: warning The gas token has 18 decimals
Arc's native gas token is USDC, but as a *native* token it uses **18 decimals**, not the 6
decimals of the ERC-20 USDC you may be used to. If you configure a wallet by hand and enter 6,
every balance and price you see will be wrong by a factor of a trillion.

The distinction matters on-chain too: the controller and the marketplace can settle in either the
native token or the 6-decimal ERC-20, and they convert between the two. See
[Fees](/protocol/fees#two-kinds-of-usdc).
:::

## Connecting

Press **Connect** in the app header. A wallet picker opens, listing the wallets you can use:
browser extensions it detects as installed, plus Rainbow, Coinbase Wallet and **WalletConnect**
for everything else. Pick one and approve the connection request in the wallet.

If you have no wallet at all, the picker's **New to Ethereum wallets?** link explains what a wallet
is and where to get one.

### On a phone

Choose **WalletConnect**. On a phone browser this offers to open your wallet app directly; on a
desktop browser it shows a QR code to scan with the wallet app on your phone. Either way the app
and the wallet stay linked until you disconnect.

## Adding the network

**The easy way.** Connect first. If your wallet is on a different network, the header button reads
**Wrong network** and a banner appears with a **Switch network** button. Press either — most
wallets will offer to add Arc Testnet automatically.

**By hand.** In MetaMask: *Settings → Networks → Add network → Add a network manually*, then
enter the values from the table above. Other wallets have an equivalent screen. Take care with
the decimals field.

## RPC endpoints

A browser app can only use an RPC endpoint that returns CORS headers. This trips up more
integrations than anything else on this page.

The public endpoint `https://rpc.testnet.arc.network` **does not send CORS headers**. It works
perfectly from a server, a script, or `curl` — and fails from every browser tab, with an error
that looks like a network outage rather than a configuration problem.

For a browser app, use a provider endpoint that sets CORS headers. The Arc Names app resolves its
endpoint from environment configuration at build time:

```bash
# .env — copy from .env.example

# Preferred: a provider key. The app builds the full URL from it.
VITE_ALCHEMY_API_KEY=your_key_here

# Or override the whole URL, for a self-hosted or alternative endpoint.
# VITE_ARC_RPC_URL=https://your-endpoint.example/v2/xyz
```

If neither is set, the app falls back to the public endpoint and logs a warning to the console
explaining that every read will fail in the browser. That fallback exists so the app still builds
without configuration — it is not a usable production setup.

::: danger Any VITE_ variable is public
Vite compiles `VITE_*` environment variables into the JavaScript bundle it ships to the browser.
Anyone who loads your app can read the key out of it. This is unavoidable for a client-side app —
the browser has to know the URL it's calling.

Protect the key with a **domain allowlist** in your provider's dashboard, so it only works when
called from your origin. Never put a key with billing or write authority in a `VITE_` variable.
:::

## Getting testnet gas

You need native USDC on Arc Testnet to pay for gas and for registrations. Use the Arc Testnet
faucet, then check the balance landed by looking your address up on
[testnet.arcscan.app](https://testnet.arcscan.app).

Testnet funds have no value. Nobody should ever ask you to buy them.

## Which wallets work

Any wallet that supports custom EVM networks and the standard browser injection or WalletConnect.
The app is built on wagmi and viem, so browser-extension wallets, mobile wallets over
WalletConnect, and hardware wallets behind either all work.

A hardware wallet is worth it for a name you care about. See
[Safety](/safety#protecting-a-name-you-care-about).

::: tip Running your own copy?
WalletConnect needs a free project ID from [Reown Cloud](https://cloud.reown.com). Set it as
`VITE_WALLETCONNECT_PROJECT_ID` in `.env`. Without it the picker falls back to offering only
installed browser extensions — which means no mobile path, so set it before deploying anywhere
people will use a phone.
:::

## Checking the connection

Once connected, the app header shows your address (or your [primary name](/guide/primary-name), if
you've set one). An amber warning triangle next to it means a name points back at your address but
the name's own record doesn't confirm it — so the app shows your address instead. See
[Primary name](/guide/primary-name).

If something is wrong, a banner appears under the header:

| Banner | Meaning |
| --- | --- |
| **Wrong network** | Your wallet is connected to a different chain. Press switch. |
| **Can't reach the Arc network** | The RPC endpoint is unreachable — see [RPC endpoints](#rpc-endpoints). |
| **Data may be out of date** | The indexer is behind the chain. On-chain reads are still correct; listings and activity may lag. See [API endpoints](/api/endpoints#sync-status). |

## Disconnecting

Press your address (or name) in the header to open the account panel, then choose **Disconnect**.
This only ends the app's session — it does not move, lock, or affect your names in any way. Your
names live in the wallet, not in the app.

## Next

- [Quick start](/guide/quick-start) — register your first name.
- [Safety & cautions](/safety) — read this before signing anything.
