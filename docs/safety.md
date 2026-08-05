# Safety & cautions

Read this before you sign anything. Arc Names is a protocol with no support desk, no recovery
mechanism and no reversals — the safeguards that exist are the ones you apply yourself.

## Testnet reality check

Arc Names currently runs on **Arc Testnet**.

- Testnet tokens have **no monetary value**. Nobody should ever ask you to buy them, and any offer
  to sell them is a scam.
- The deployment may be **reset or redeployed**. Names registered now carry no guarantee of
  surviving.
- A testnet name grants **no claim on a mainnet name**. If anyone tells you registering now
  reserves a mainnet name, they are making that up.

Use this to try the protocol, not to store anything you'd miss.

## There is no recovery

The wallet holding the name *is* the name. If you lose access to it, the name is gone.

- No password reset. No support ticket. No admin who can move it back.
- No way to reverse a transfer to a wrong address.
- No way to recover from a phishing signature you approved.

The protocol has no concept of your identity apart from your keys. This is the trade-off for
nobody being able to take your name away either.

## Protecting a name you care about

**Hold it in a wallet with real key security.** A hardware wallet or a multisig. A hot browser
wallet is fine for experimenting and a poor place for anything valuable.

**Back up the seed phrase offline.** On paper or metal, never in a photo, cloud note, password
manager sync, or anywhere connected to a network. Nobody legitimate will ever ask for it — not
Arc Names, not a moderator, not "support". Anyone who does is stealing from you.

**Renew from a different wallet.** Renewal is permissionless — anyone can renew any name. So a
name held in cold storage can be renewed from a hot wallet without ever exposing the hardware key.
Use this. It means the wallet holding a valuable name almost never has to sign anything.

**Register for longer.** Fewer renewals means fewer chances to forget, and fewer transactions.

## Look-alike names

The on-chain validity check is looser than the app's. `ArcController.valid()` enforces length and
rejects uppercase ASCII — and nothing else. It does not restrict the character set.

The app only lets you *type* lowercase letters, digits and hyphens. But anyone calling the contract
directly can register a name containing Unicode, invisible characters, or glyphs that render
identically to ASCII.

::: danger A name that looks right may not be the name you think
Two names can be visually indistinguishable and be entirely different on-chain. This is the
classic homoglyph attack, and a naming service is exactly where it's most valuable to an attacker.

Never judge a name by its appearance in a marketplace listing, an activity feed, a DM, or a
screenshot. Before acting on one:

- Resolve it and check the **address** it points at.
- Compare that against an address you obtained independently.
- For anything consequential, copy the name and inspect it — a name with unexpected characters
  will not match the one you expect byte for byte.
:::

## Reverse records are claims, not proof

Anyone can set their reverse record to any string. `attacker.arc` can claim to be `vitalik.arc`.

The only thing that makes a reverse name trustworthy is the **round-trip**: the name must forward-
resolve back to the same address. The UniversalResolver returns a `verified` flag that does this
check.

If you are building an interface: **never display an unverified reverse name.** Fall back to the
raw address. Displaying an unverified name is how your users get phished. See
[Your primary name](/guide/primary-name#verification-and-why-it-matters).

## Buying a name safely

**Only pay inside an atomic transaction.** The marketplace transfers the name and pays the seller
in the same transaction — either both happen or neither does.

::: danger "Send me the money and I'll transfer it" is theft
There is no escrow, no dispute process, no reversal. If you send funds first, you have no
recourse. This is the most common way people lose money in naming services.

Use a marketplace listing, or a contract that swaps both sides atomically. Never a handshake.
:::

**Always pass an explicit `maxPrice`.** The `buy(id)` overload sets the maximum to whatever you
sent, so a seller can front-run your purchase with a price increase and take it. Use
`buy(id, maxPrice)`.

**Check the expiry before you buy.** A name with two weeks left needs renewing immediately, and
that cost is part of the real price.

**After buying, reclaim and update `setAddr`.** Until you do, the seller may still control your
records, and the name still resolves to *their* address — so anyone paying it pays them.

## Approvals

`setApprovalForAll` authorises an operator over **every name you hold and every name you register
in future**, until you revoke it.

- Prefer per-token `approve` where possible.
- Only grant blanket approval to contracts you have a reason to trust.
- Revoke when you're done. Approvals do not expire.

A malicious contract with blanket approval can take every name you own in one transaction.

## Verifying contract addresses

Fake addresses that mimic the real contracts are the most common phishing vector in any naming
service.

- Get addresses from [Contract addresses](/protocol/contracts), served from a site you navigated
  to yourself.
- Cross-check on [testnet.arcscan.app](https://testnet.arcscan.app) — confirm it's a contract with
  plausible history.
- Confirm you're on chain ID `5042002`.
- **Never take a contract address from a DM**, a support chat, or a search advert.

Remember also that every address is a **proxy**. Calling an implementation directly returns zeros
rather than reverting — a silent failure that looks like "the name doesn't exist".

## Reading what you sign

Before confirming any transaction, check three things in your wallet:

1. **The contract** you're calling — does it match an address from the official docs?
2. **The function** — does it match what you think you're doing? `setApprovalForAll` when you
   expected `list` is an attack.
3. **The value** — is the amount what you expected?

A transaction that asks for far more than the price you were shown, or for approval you didn't
request, should be rejected.

## Records are public and permanent

Everything in a text record is plaintext on a public chain, readable by anyone, forever.
Overwriting does not erase — the old value stays in transaction history.

Don't put anything in a record you wouldn't publish. An `email` record will be scraped.

Nothing in a record is verified. A `com.twitter` record is a self-reported claim; the protocol
never checks it.

## Trust assumptions

Being honest about what you're trusting:

**The contract owner can upgrade every contract.** All are UUPS proxies. An upgrade can change any
behaviour described in these docs. This allows fixing bugs; it also means the rules can change.

**The owner controls prices, `minLen`, commit ages, fees and referral rates.** Not `GRACE`,
`MIN_DURATION` or `MAX_DURATION` — those are hard constants.

**The indexer can be wrong.** It lags the chain and can fail. For display that's fine; for anything
that moves value, read the contracts. Check `/api/v1/sync-status`.

**These contracts have not been through a published third-party audit.** Treat the deployment
accordingly.

## When the app can't reach the network

If you see *"Can't reach the Arc network right now"*, the app cannot talk to its RPC endpoint.

The usual cause is CORS. The public endpoint `https://rpc.testnet.arc.network` does not send CORS
headers, so it fails from every browser tab while working perfectly from `curl` or a server. A
browser deployment needs a provider endpoint that sets CORS headers. See
[Connecting a wallet](/guide/connecting-a-wallet#rpc-endpoints).

Browsers cannot distinguish a CORS block from DNS failure or a server being down — all three
surface identically as an opaque fetch rejection. So this message means "the request didn't
complete", not necessarily "the network is down".

**This is not a reason to enter your seed phrase anywhere.** No network problem is ever fixed by
providing a seed phrase.

## Deploying the app yourself

::: danger Any VITE_ variable is public
Vite compiles `VITE_*` variables into the JavaScript bundle it ships to browsers. Anyone loading
your app can extract them. This is unavoidable for a client-side app.

- Set a **domain allowlist** on any RPC provider key so it only works from your origin.
- Never put a key with billing or write authority in a `VITE_` variable.
- Rotate any key that has been pasted into a chat, a ticket, or a commit.
:::

## Scams to expect

- **"Claim your mainnet name now."** There is no mainnet claim.
- **"Verify your wallet to keep your name."** Never a real requirement.
- **"Support" asking for your seed phrase.** Always theft.
- **Look-alike names** in listings or DMs. See [above](#look-alike-names).
- **A cheap listing for a valuable name.** Check the expiry and the exact characters.
- **Fake app URLs.** Bookmark the real one and use the bookmark.
- **Airdrop or points claims** requiring approval of an unknown contract.

## If something goes wrong

**Approved a malicious transaction:** immediately revoke approvals from the affected wallet and
move remaining assets to a wallet whose keys have never touched that machine.

**Sent a name to a wrong address:** it is not recoverable. If the address belongs to someone
reachable, ask.

**Let a name expire:** you have 90 days from the expiry to renew it. Do it now — see
[Renewals & expiry](/guide/renewals).

**Lost your commit secret mid-registration:** you lose the commit gas only. Start again.

## Next

- [Connecting a wallet](/guide/connecting-a-wallet) — network setup.
- [Contract addresses](/protocol/contracts) — verified addresses.
- [FAQ](/reference/faq) — common questions and errors.
