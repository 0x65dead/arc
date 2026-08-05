---
layout: home

hero:
  name: Arc Names
  text: Your identity on Arc
  tagline: One .arc name for payments, profiles and apps across the network.
  image:
    src: /logo.png
    alt: Arc Names
  actions:
    - theme: brand
      text: Quick start
      link: /guide/quick-start
    - theme: alt
      text: What is Arc Names?
      link: /guide/what-is-arc-names
    - theme: alt
      text: API reference
      link: /api/endpoints

features:
  - title: Register a name
    details: Search, commit, register. A two-step flow that stops anyone from front-running the name you asked for.
    link: /guide/registering
    linkText: How registration works
  - title: Point it anywhere
    details: An address, a website, an avatar, a social handle. Records live on-chain and any app can read them.
    link: /guide/records
    linkText: Records & profile
  - title: Own it as an NFT
    details: Every .arc name is an ERC-721 token. Transfer it, sell it on the marketplace, or hold it for a decade.
    link: /guide/ownership
    linkText: Ownership & transfers
  - title: Build on it
    details: Resolve names straight from the contracts, or read indexed history through a paginated REST API.
    link: /protocol/resolving
    linkText: Resolving .arc
---

## Two paths through these docs

<p><a href="/">← Back to the Arc Names app</a></p>

**If you want to use Arc Names**, start at [Quick start](/guide/quick-start) and work down the
*Using Arc Names* section — registering, renewals, records, the marketplace. No code required.

**If you are integrating Arc Names**, start at [Resolving .arc](/protocol/resolving) for the
on-chain lookup path, then [Contract addresses](/protocol/contracts) and the
[API endpoints](/api/endpoints).

Either way, read [Safety & cautions](/safety) before you sign anything.

::: warning Testnet
Arc Names currently runs on **Arc Testnet**. Names registered here are for testing. They carry no
promise of a mainnet name, and the deployment may be reset. See [Safety](/safety#testnet-reality-check).
:::
