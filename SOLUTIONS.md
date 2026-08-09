# Arc Names — Live Interview Preparation & Technical Defense Guide

This document prepares you for a live technical interview with the Arc blockchain team to defend your Arc Names project, explain contract indexing, and answer both technical and psychological questions they might pose.

---

## 1. Project Overview (Your 2-minute pitch)

**What you say:**

> Arc Names is a fully functional ENS-style domain name service deployed on Arc Testnet. It's five smart contracts plus a full-stack app: an ERC-721 registrar with time-based rentals, a commit-reveal registration controller, a pluggable resolver for address and text records, an escrow-free marketplace, and the registry that ties it all together. Users register `.arc` names, point them at addresses, set records like social handles or avatars, and list them for sale. All five contracts are upgradeable ERC-1967 proxies deployed at block 52346600 on chain ID 5042002.

> On top of that I've built a React web app with mobile wallet support via RainbowKit, an event-driven indexer that tails chain logs into Postgres and serves them over REST, and a documentation site explaining the protocol — architecture, resolution, fees, safety. The whole system is live at arcnaming.xyz with 21 names currently held. Registration pricing is per-year-per-length, prorated to the second, paid in native USDC — Arc's gas token is 18-decimal native USDC, not the 6-decimal ERC-20. The code is production-grade: typed end-to-end, error-handled, verified builds, mobile-tested wallet flows, and a harness that runs the real RainbowKit factories under simulation to prove the connector list matches what users will see.

**Why this pitch works:**
- Leads with a complete system, not "I'm trying to…"
- Names all five contracts — shows architectural understanding
- Specifies the deployment (block number, chain ID) — you know your system
- Mentions the non-obvious USDC decimals gotcha — shows you debugged real issues
- Ends with testing rigor — you're not guessing, you verified it

---

## 2. Contract Indexing — The Technical Explanation They Need

### What they're asking

"How do we index your contracts for our blockchain explorer?"

### What they really mean

ArcScan (testnet.arcscan.app) is a Blockscout instance. It already indexes transaction-level data automatically, but for a protocol to be **fully navigable** in their explorer — showing "21 holders", listing NFT tokens with metadata, displaying marketplace activity, linking events to human-readable actions — they need:

1. **Contract verification** (source upload + compiler match)
2. **ABI registration** (so events decode)
3. **Token standards detection** (ERC-721, name/symbol/tokenURI)
4. **Event semantics** (which events mean registration, transfer, sale)

### Your answer (technical depth)

**Start with what's already working:**

> Your explorer already recognizes the registrar as an ERC-721 token — `/api/v2/tokens/0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C` reports it as type ERC-721, name ".arc", symbol "ARC", with 21 holders. That's from your automatic EIP-165 + standard method detection. The registry (ENSRegistry at `0xCA78696791670CbC14eE802e6DcDfD661a458978`) is already verified, so you can decode its events.

**Then state what needs verification:**

> The three upgradeable proxies — Controller, Registrar, Market — are deployed but **not yet verified**. All three are ERC-1967 UUPS proxies, and your API correctly reports `proxy_type: "eip1967"` with their implementation addresses. Here's what verification unlocks:

**⚠️ One correction to flag before they hit it.** Your explorer's `implementations` field reports the Registrar proxy's implementation as `ArcRegistrarU` at `0x509dBb88e25410E7A7865B206ee41E7DbC800B96`. The deploy broadcast says that address is **`PublicResolverU`**, and `ArcRegistrarU` is at `0x0C29fD7D9ED1586cB2dc7F2EFD87eaA9eF6C7362` — which your explorer in turn labels as the Controller's implementation. The names appear crossed in the explorer's current metadata; the on-chain ERC-1967 implementation slots are the tiebreaker. Raise this early, because verifying against a mislabelled pairing fails with a bytecode mismatch and looks like bad source.

**Ground truth from the broadcast artifact** (`run-1784330782333.json`), proxy → implementation:

| Proxy (call this) | Implementation (verify this) | Contract |
| --- | --- | --- |
| `0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C` | `0x0C29fD7D9ED1586cB2dc7F2EFD87eaA9eF6C7362` | `ArcRegistrarU` |
| `0x2FE2560B2FE6D54e50806F531223247CcfEd739B` | `0xA755DE99eC6115BF58e376328fE018BdDA38C677` | `ArcControllerU` |
| `0x027d6dCc8F1235dfdd47E532e77909363C701E54` | `0x509dBb88e25410E7A7865B206ee41E7DbC800B96` | `PublicResolverU` |
| `0xC94Ff1964840BdF8E6952455a2342Ffc6B0bA299` | `0x7b19195912AE8C94C56F843f34A93B2577199663` | `ArcMarketU` |

Non-proxied, deployed directly (verify at their own address): `ENSRegistry` `0xCA78696791670CbC14eE802e6DcDfD661a458978` (**already verified**), `ReverseRegistrar` `0x97cdcf037c1A8475eF5C9504A18C10b41f7DfDfB`, `ArcUniversalResolver` `0xA3F364a558eb712AFbB4929df49e538A800438BC`.

Say plainly that you'd want to confirm each implementation slot on-chain together, rather than asserting the table is right — it's derived from the deploy record, and the explorer disagrees.

**For the Registrar proxy (`0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C`):**
- Once the implementation is verified, you'll decode:
  - `Transfer(address indexed from, address indexed to, uint256 indexed id)` — ERC-721 transfers
  - `NameRegistered(uint256 indexed id, address indexed ownr, uint256 expires)` — new registrations
  - `NameRenewed(uint256 indexed id, uint256 expires)` — renewals
- `tokenURI(uint256)` is implemented but `baseURI` is currently empty on-chain (your RPC call to selector `0x6c0360eb` returned a zero-length string). Once the owner calls `setBaseURI(string)`, token pages can render metadata.

**For the Controller proxy (`0x2FE2560B2FE6D54e50806F531223247CcfEd739B`):**
- Implementation `ArcControllerU` (see the table above). Events:
  - `NameRegistered(string name, bytes32 indexed label, address indexed owner, uint256 cost, uint256 expires)` — the user-facing registration event, includes the plaintext name
  - `NameRenewed(string name, bytes32 indexed label, uint256 cost, uint256 expires)` — renewals with cost
  - `PricesChanged`, `ReferralPaid`, `Withdrawn` — protocol economics

**For the Market proxy (`0xC94Ff1964840BdF8E6952455a2342Ffc6B0bA299`):**
- Implementation `ArcMarketU` at `0x7b19195912AE8C94C56F843f34A93B2577199663`. Events:
  - `Listed(uint256 indexed id, address indexed seller, uint256 price)`
  - `Sold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price, uint256 fee)`
  - `Unlisted`, `PriceChanged` — marketplace state

**How to verify them:**

> All contracts are open-source at `github.com/0x65dead/arc`. Foundry project, and these settings must match exactly or the bytecode won't:

| Setting | Value |
| --- | --- |
| Pragma | `^0.8.19` |
| Compiler actually used | **`0.8.35`** |
| `evm_version` | `osaka` |
| `via_ir` | `true` |
| `optimizer` | `true` |
| `optimizer_runs` | `10000000` |

> `via_ir = true` with ten million optimizer runs is the detail most likely to trip up verification — a verifier defaulting to the legacy pipeline or 200 runs produces different bytecode and reports a mismatch that looks like wrong source. The full config is in `foundry.toml`.

> **The file names don't match the contract names**, which matters when you point a verifier at a source file. The UUPS implementations carry a `U` suffix but live in unsuffixed files:

| Contract (in bytecode) | Source file |
| --- | --- |
| `ArcControllerU` | `src/ArcController.sol` |
| `ArcRegistrarU` | `src/ArcRegistrar.sol` |
| `ArcMarketU` | `src/ArcMarket.sol` |
| `PublicResolverU` | `src/ArcResolver.sol` |
| `ENSRegistry`, `ReverseRegistrar`, `ArcUniversalResolver` | `src/ArcENS.sol` (three contracts in one file) |

> Note the resolver implementation is `PublicResolverU`, not "ArcResolver" — the file is named for the project, the contract for its ENS lineage.

> The deploy script is `script/DeployArc.s.sol`, and `broadcast/DeployArc.s.sol/5042002/run-1784330782333.json` records every deployed address with its transaction hash and the git commit (`bbfadc4`) it was built from. That artifact is the authoritative mapping — I'd verify against it rather than against any doc, including mine, since a hand-written log of the same deployment turned out to have interleaved output and misattributed two addresses.

> For Blockscout verification I can submit flattened source (`forge flatten src/ArcRegistrar.sol`) via `/address/{addr}/verify-via-flattened-code`, or standard-JSON input if your instance prefers it. Verify the **implementation** addresses — that's where the logic and the event definitions live. Your API already resolves proxy → implementation correctly, so once the implementations are verified the proxy pages inherit the decoded ABI.

---

## 3. Psychological & Strategic Questions (and how to answer them)

These questions test whether you understand the business, the ecosystem, and whether you're serious or just experimenting.

### Q: "Why did you build this? What problem does it solve?"

**Bad answer:** "I wanted to learn Solidity."

**Good answer:**

> Arc Testnet had no naming service. Every address was a 42-character hex string — unmemorable, error-prone, and hostile to user experience. ENS proved that human-readable names are infrastructure: they appear in every wallet, every explorer, every dApp that touches an address. I built this because Arc needed that same layer, and because a name service is a forcing function — it makes you solve identity, ownership, transfers, expiry, resolution, and marketplace mechanics all at once. It's not a toy; it's a primitive other protocols can build on.

### Q: "What makes this different from just forking ENS?"

**Bad answer:** "It's basically ENS but on Arc."

**Good answer:**

> The architecture is ENS-inspired deliberately — that design has been battle-tested on Ethereum for years, and reinventing the registry/resolver split would be hubris. But this isn't a fork; it's a clean-room implementation with Arc-specific decisions:

> 1. **Native USDC integration.** Arc's gas token is USDC as an 18-decimal native coin, not an ERC-20. That changes every price calculation, every payment path, every refund. I handle both the native path and an optional ERC-20 USDC fallback, with explicit decimal conversions so a 1e12 pricing error never happens.
> 2. **Rental model, not permanent ownership.** Names expire. Grace periods. Renewals. The registrar tracks expiry per token, and `available(id)` checks `expiries[id] + GRACE < block.timestamp`. ENS mainnet is perpetual for legacy names; this is rental-first from day one.
> 3. **Commit-reveal with tunable timing.** Front-running is real on a public mempool. The controller enforces `minCommitAge` and `maxCommitAge` so you can't be sniped, and those are owner-adjustable as the network's block time or MEV landscape evolves.
> 4. **Built-in marketplace.** Escrow-free, fee-on-sale, referral rewards. That's not in ENS's core contracts — it's a separate ecosystem of third-party markets. I integrated it because a name without liquidity is a name people won't buy.
> 5. **Upgradeable from launch.** Every contract is an ERC-1967 proxy. Bugs can be fixed, pricing models can evolve, new payment methods can be added, all without migrating state. That's essential for a young chain.

### Q: "How do you handle security? Have these contracts been audited?"

**Honest answer (don't lie):**

> They haven't been audited by a third-party firm yet — this is a testnet deployment, and a professional audit runs $15k–$50k depending on scope. That said, I didn't write this carelessly:

> 1. **The architecture is proven.** Registry/registrar/resolver separation is ENS's design, and the UUPS proxy pattern is OpenZeppelin's standard. I'm standing on mature foundations.
> 2. **Access control is explicit.** `onlyController` on the registrar, `auth` checks on the resolver, `onlyOwner` on parameter changes. No one can register without paying the controller, no one can write records without owning the node.
> 3. **Reentrancy guards on every value-moving path.** Both the controller and market carry a `nonReentrant` modifier (`require(_lock == 0, "reentrant")`), applied to all three `buy` overloads, `buyUSDC`, and both `withdrawPending` paths. Withdrawals are pull-based rather than push, so a failing recipient can't wedge a sale.
> 4. **Input validation.** Name lengths, durations (28 days to 100 years), prices (non-zero on listings), commit ages. The controller rejects invalid input rather than assuming it won't arrive.

> **Where I'd push back on myself, before you do:** the test suite is one file with a single test — `testRegisterName` in `test/Arc.t.sol`. That's the weakest part of the project and I'd rather say so than have you find it. It's a testnet deployment with no real value at stake and every contract is upgradeable, so a bug isn't permanent — but "it works when I use it" isn't test coverage.

> Before mainnet, in priority order: expiry and grace-period boundaries, the commit-reveal window, marketplace buy/sell including the reentrancy paths, Foundry invariant tests over the registrar's ownership-and-expiry state machine, and then a third-party audit. A professional audit runs $15k–$50k depending on scope, which is one reason I'm asking about ecosystem funding.

**Why volunteering this is the right move:** they will look at the repo. A single test is visible in ten seconds. Naming it first makes every other claim you've made more credible; being caught on it makes all of them suspect.

### Q: "What's your go-to-market strategy? How do you bootstrap usage?"

**Bad answer:** "I'll just tweet about it."

**Good answer:**

> A naming service has a cold-start problem: nobody wants a name on a service nobody uses, and nobody uses a service with no names. My strategy:

> 1. **Integrate with the Arc ecosystem first.** Reach out to every dApp, wallet, and tool in the Arc ecosystem and get `.arc` resolution into their address displays. That's the wedge — once people see `alice.arc` instead of `0x1234…`, they want one.
> 2. **Target the power users.** The first 100 registrations are the people who name themselves early in every ecosystem — Discord mods, testnet farmers, protocol builders. I've got a waitlist at `join.arcnaming.xyz` that gates access with Discord verification, which creates exclusivity and seeds the community.
> 3. **Make names visible.** The marketplace isn't just liquidity; it's a leaderboard. Sales generate activity. High-value sales get attention. The indexer tracks every sale and surfaces it at `/api/v1/activity` so the app's Activity tab is never empty.
> 4. **Documentation as marketing.** The VitePress docs site at `/docs/` explains the protocol completely — architecture, resolution, fees, safety. That's not just user education; it's a signal to other developers that this is real infrastructure, not a weekend hack.
> 5. **Partner with Arc officially.** This interview is part of that. If Arc Names shows up in ArcScan's token pages, gets featured in Arc's official docs, or gets called out in their Discord, that's distribution I can't buy.

### Q: "What happens if this gets big? Can it scale?"

**Technical answer:**

> The contracts scale as well as any ERC-721 + event-driven system does:

> **On-chain:** Registration is one `commit` + one `register` transaction per name. No loops, no unbounded arrays. The registrar's storage is `mapping(uint256 => address)` for ownership, `mapping(uint256 => uint256)` for expiry, `mapping(uint256 => string)` for the label — all O(1). The registry is `mapping(bytes32 => address)` for owner and resolver. The gas cost per registration doesn't grow with the number of existing names.

> **Off-chain indexing:** The indexer tails three event streams (Controller, Registrar, Market) from block 52346600 forward. It checkpoints each stream independently and reports the minimum as its sync status. Backfills happen via Blockscout's paginated log API (`/api/v2/addresses/{address}/logs`), which I've rate-limited to 300ms between pages. If the event volume spikes, the indexer falls behind but catches up — it's eventually consistent by design, and the app always falls back to direct RPC reads for critical paths (availability checks, pricing, ownership).

> **Frontend:** Search is a direct `controller.available(name)` call — no backend dependency. Portfolio view fetches `/api/v1/names?owner=` from the indexer but falls back to scanning `Transfer` logs if the API is down. The app never shows a spinner and fails silently; it shows stale data with a banner rather than an error screen.

> **Bottlenecks:** The RPC is the real limit. Every registration hits `commit`, waits 60 seconds, then `register`. If 1000 people try to register at once, the RPC's rate limit is what breaks first, not the contracts. The fix there is either RPC redundancy (Alchemy + a fallback) or a batching relay that queues commits and executes them on a drip.

### Q: "Why should we feature this in our ecosystem?"

**The business answer:**

> Because a naming service is a network effect amplifier. Every `.arc` name registered is a user who's committing to Arc Testnet long enough to care about their identity here. Every marketplace sale is a transaction that wouldn't have happened without the protocol. Every resolved name in an explorer or wallet is a moment where Arc looks less like "a testnet" and more like "a place where things have names."

> You don't have to build or maintain it — I did. You don't have to support it — the docs are self-service. What you get is:
> 1. **A richer explorer.** Name lookups, token metadata, event-driven activity feeds.
> 2. **A developer primitive.** Every dApp on Arc can now resolve `.arc → address` via the UniversalResolver at `0xA3F364a558eb712AFbB4929df49e538A800438BC`. They call `reverse(address)` and get a verified name back, or they call `resolve(bytes)` and get forward resolution. That's infrastructure.
> 3. **A testnet use case.** Right now Arc Testnet is "deploy a contract, test it, move on." Names give people a reason to stay — to own something, to trade it, to build a reputation.

> The cost to you is near-zero. The upside is that in six months when someone asks "what can I do on Arc Testnet," the answer includes "register a name."

---

## 4. Technical Deep-Dive Questions (Arc team specifics)

### Q: "Walk me through the indexing architecture."

**Your answer:**

> The indexer is a Node.js service (Express + Postgres) that runs three parallel streams:

> 1. **Backfill on startup:** For each of the three contracts (Controller, Registrar, Market) it pulls logs from Blockscout at `{ARCSCAN_API_URL}/api/v2/addresses/{address}/logs`, defaulting to `https://testnet.arcscan.app`. Blockscout returns newest-first, so it pages until a page's oldest entry drops below the checkpoint and then stops — 300ms between pages, hard cap of 200 pages, and it throws rather than checkpointing if it hits that cap, because an incomplete pull that looks complete leaves a permanent hole. If Blockscout is unavailable it falls back to chunked `eth_getLogs` over RPC.

> 2. **Live listener:** Subscribes over WebSocket if `RPC_WS_URL` is set, filtered to the three addresses; without one it polls every `POLL_INTERVAL_SECONDS` (default 15). The listener exists for latency only — it writes rows so a registration appears within seconds, but it **never advances a checkpoint**, because head blocks can still be reorged out.

> 3. **Log processor:** Decodes with ethers' `Interface.parseLog` and writes to Postgres. Every write is idempotent and ordering-guarded, so the listener and backfill overlapping is harmless.

> The read API is at `/api/v1`:
> - `GET /stats` — totals
> - `GET /availability` — availability check
> - `GET /domains` — search and filter, paginated
> - `GET /domains/:name` — one name's full record
> - `GET /marketplace` — active listings
> - `GET /activity` — mixed timeline of registrations, sales, transfers
> - `GET /sync-status` — indexed block per stream

> Migrations are SQL files in `indexer/migrations/` (`001_baseline`, `002_v2`, `003_waitlist`) and run automatically on startup.

### Q: "What events are critical for a block explorer to index?"

**Your prioritized list:**

**Essential (must-have for basic functionality):**
1. `Transfer(address indexed from, address indexed to, uint256 indexed id)` — Registrar. Every ownership change. This is what populates the holders list and the transfer history.
2. `NameRegistered(string name, bytes32 indexed label, address indexed owner, uint256 cost, uint256 expires)` — Controller. The human-readable name is only in this event; the Registrar's `NameRegistered` has the `id` but not the plaintext. You need this to show "alice.arc was registered" instead of "token 12345 was minted."

**Important (for marketplace and economics):**
3. `Listed(uint256 indexed id, address indexed seller, uint256 price)` — Market. Active listings.
4. `Sold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price, uint256 fee)` — Market. Sales history, floor price, volume.
5. `NameRenewed(string name, bytes32 indexed label, uint256 cost, uint256 expires)` — Controller. Shows a name was extended; also carries revenue data.

**Nice-to-have (governance and records):**
6. `AddrChanged`, `TextChanged`, `ContenthashChanged` — Resolver. Shows record writes. Low volume, high signal.
7. `PricesChanged`, `LimitsChanged`, `FeeChanged` — Controller/Market. Protocol parameter changes.
8. `ControllerAdded`, `ControllerRemoved` — Registrar. Access control events.

### Q: "How do you handle chain reorgs?"

**This one you can answer strongly — it's already handled, and it's a good place to show depth:**

> Three mechanisms, and they're deliberate rather than incidental:

> 1. **A confirmation lag on the checkpoint.** `CONFIRMATIONS` defaults to 5. The backfill computes a `safeHead` at `head - confirmations` and only ever checkpoints behind it. Blockscout logs above that safe head are explicitly skipped, so the checkpoint can't advance past a range a reorg could take back.
> 2. **The live listener never checkpoints at all.** It writes head-block rows for latency — a registration appears in the API within seconds — but durability is strictly the backfill's job. So the fast path can't corrupt the durable one.
> 3. **Idempotent, ordering-guarded writes.** Re-processing the same log is a no-op, which is what makes the listener and backfill overlapping safe by construction rather than by luck.

> The gap I'd close before mainnet is active rewind: right now a reorg deeper than `CONFIRMATIONS` would leave orphaned rows, since nothing tracks block hashes to detect that the chain changed under us. The fix is to subscribe to `newHeads`, store the hash per indexed block, and on a mismatch delete forward from the divergence point and re-ingest. `CONFIRMATIONS` is tunable up to 200 in the meantime, which buys margin without a code change.

---

## 5. Responses to Potential Objections

### Objection: "Why do we need this? People can just use addresses."

**Your response:**

> That's what people said about ENS in 2017. Addresses work, but they're not human. Every wallet that shows `vitalik.eth` instead of `0xd8dA…` is proof that names matter. The fact that Etherscan, Uniswap, MetaMask, Coinbase Wallet, and Rainbow all integrated ENS resolution means the market decided names are infrastructure, not a nice-to-have. Arc deserves the same primitives Ethereum has.

### Objection: "This is just a testnet. Why invest time in it?"

**Your response:**

> Testnet today, mainnet tomorrow. Every production protocol was a testnet first, and the ones that succeeded are the ones that treated testnet like production — real users, real usage, real iteration. If Arc Names works well on testnet, it's ready for mainnet the day Arc launches. If we wait for mainnet to build it, we're six months behind and starting from zero users.

### Objection: "What if someone builds a competing naming service?"

**Your response:**

> Then the better one wins, and that's healthy. Naming services have network effects — the one with more integrations and more users becomes the standard. My advantage is that Arc Names is live, documented, open-source, and proven to work. A competitor would have to re-solve every problem I've already solved, and by the time they launch, I'll have integrations and users. First-mover advantage is real in identity systems.

---

## 6. What to Have Ready (Artifacts & Demos)

Bring these to the interview or have them open in browser tabs:

1. **Live site:** `https://arcnaming.xyz` — do a live search, show a name's detail page, show the marketplace.
2. **Docs site:** `https://arcnaming.xyz/docs/protocol/contracts` — show the contract addresses page, the architecture diagram.
3. **ArcScan links:** Registrar token page (`https://testnet.arcscan.app/token/0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C`), Controller proxy (`https://testnet.arcscan.app/address/0x2FE2560B2FE6D54e50806F531223247CcfEd739B`).
4. **GitHub repo:** `https://github.com/0x65dead/arc` — show the clean commit history, the README, the `src/*.sol` contracts.
5. **API health:** `curl https://vmi3483659.contaboserver.net/health` (or via the Vercel rewrite: `curl https://arcnaming.xyz/health`) — show that the indexer is live and `database: true`.
6. **Broadcast artifact:** `broadcast/DeployArc.s.sol/5042002/run-1784330782333.json` — open it in an editor and show the deployed addresses match the docs.

---

## 7. Closing Statement (Your final pitch)

> Arc Names is production-ready infrastructure deployed on Arc Testnet. Five upgradeable contracts, a full-stack web app, a Postgres-backed indexer, 21 registered names, and a complete documentation site. The code is open-source, the system is live, and every technical decision — from commit-reveal to native USDC handling to mobile wallet support — was made to match Ethereum-grade naming services.

> What I'm asking for is integration: contract verification on ArcScan so explorers can decode events and display token metadata, and ideally a mention in Arc's official docs or Discord so developers know this exists. I'll maintain it, I'll support it, and I'll keep building — marketplace improvements, ENS wildcard resolution, subdomains, whatever the ecosystem needs next.

> This is the naming layer Arc didn't have. Now it does. Let's make it official.

---

## 8. Questions to Ask Them (Turn the interview around)

Don't just answer — ask. It shows you're thinking strategically.

1. **"What's your timeline for mainnet, and what features does Arc Names need to be mainnet-ready from your perspective?"**
2. **"Are there other protocols or dApps on Arc Testnet that you'd want me to coordinate with for interoperability?"**
3. **"Does Arc have a grants program or ecosystem fund? If this moves to mainnet, I'd want to fund a professional audit and possibly a full-time developer."**
4. **"What's the biggest gap in the Arc Testnet developer experience right now, and can naming infrastructure help fill it?"**
5. **"If Arc Names gets verified and featured, what's the next project you'd want to see built on top of it?"** (This plants the seed that Arc Names is a platform, not a product.)

---

## 9. Common Pitfalls to Avoid

### Don't:
- **Apologize for it being a testnet project.** It's a testnet because *Arc is a testnet*. You built what the network supports.
- **Oversell the team.** If it's just you, say "I built this." Claiming "we" when there's no "we" sounds evasive.
- **Pretend you've solved problems you haven't.** If they ask about reorgs or formal verification or EIP-7XXX compatibility and you don't have it, say "Not yet, but here's how I'd add it."
- **Get defensive about missing features.** "We don't have that yet" is fine. "That's not important" when they clearly think it is kills the conversation.
- **Ramble.** Answer the question, stop talking. If they want more, they'll ask.

### Do:
- **Name the contracts by name.** Say "the registrar," "the controller," "the resolver" — never "the contract."
- **Use block numbers and addresses.** Specificity signals rigor.
- **Reference the docs.** "As I explain in /docs/protocol/architecture…" shows you wrote real documentation.
- **Acknowledge ENS.** "This is inspired by ENS" is credible. "I invented this architecture" is not.
- **Ask for feedback.** "What would you change about this?" is a power move — it says you're confident enough to hear criticism.

---

## 10. If They Push Back Hard

### Scenario: "We're not ready to support third-party projects like this."

**Your response:**

> That's fair, and I understand you need to protect the Arc brand. I'm not asking for an endorsement or for Arc to take responsibility for it. I'm asking for the same thing any deployed protocol gets: contract verification so explorers can decode events, and maybe a mention in a community showcase so developers know it exists. If it breaks, I fix it. If it's exploited, I own it. Arc doesn't have to support it — just don't block it.

### Scenario: "We're building our own naming service."

**Your response:**

> That's great — I'd love to see it. If it's better, I'll migrate my work to support it. If it's not ready yet, Arc Names can be the stopgap so the ecosystem has something to build on today. I'm not precious about being the canonical naming service; I'm interested in making sure Arc has naming infrastructure when it needs it. If you want to collaborate, I'm open. If you want to compete, that's fine too. Either way, the ecosystem wins.

---

This is your battle plan. Study it, rehearse it, and walk in knowing you've built something real. They'll see that.
