# API endpoints

The Arc Names indexer exposes a REST API at `/api/v1` for querying names, activity and marketplace
listings without reading the chain directly. All endpoints return JSON and take query parameters
where specified.

Base URL depends on deployment. The app defaults to a same-origin `/api` path proxied by Vite in
dev, or an explicit origin from `VITE_INDEXER_API_URL`. For direct access, substitute the indexer's
public origin.

## Authentication

None. Every endpoint is public read-only.

## CORS

The indexer sets CORS headers from the `CORS_ORIGINS` environment variable. A wildcard (`*`) allows
any origin; a comma-separated list restricts to those origins. Missing or empty defaults to no
CORS, which breaks browser clients.

## Endpoints

### `GET /api/v1/stats`

Aggregate statistics across the entire deployment.

**Parameters:** none

**Response:**

```ts
{
  totalRevenueWei: string;      // gross lifetime volume, registrations + renewals
  namesRegistered: number;      // ever registered
  namesActive: number;          // expiry in the future
  namesInGrace: number;         // past expiry, within 90 days
  activeListings: number;
  totalSalesVolumeWei: string;
}
```

All `*Wei` fields are stringified integers in 18-decimal native wei.

### `GET /api/v1/availability?name=<label>`

Three-state availability for a single name. This wraps the on-chain `controller.available()` with
the indexed expiry, so it knows the release date for names in grace.

**Parameters:**

| Name | Required | Notes |
| --- | --- | --- |
| `name` | Yes | The label only, no `.arc` |

**Response:**

```ts
{
  name: string;
  taken: boolean;                 // true = registered or in grace
  status: 'available' | 'registered' | 'grace';
  owner?: string;                 // present when taken
  expiresAt?: number;             // Unix timestamp
  releasesAt?: number;            // expiresAt + 90 days, only when status = 'grace'
}
```

When `taken` is false, the name is registerable right now. When `taken` is true and
`status === 'grace'`, it's expired but still locked — `releasesAt` tells you when it frees up.

**Errors:**

- 400 — name is invalid or missing

### `GET /api/v1/domains?owner=<address>`

All names currently owned by an address, regardless of expiry or listing status. Not paginated —
returns the full array.

**Parameters:**

| Name | Required | Notes |
| --- | --- | --- |
| `owner` | Yes | Ethereum address, checksummed or lowercase |

**Response:**

```ts
{
  items: Array<{
    name: string;
    tokenId: string;
    owner: string;
    expiresAt: number;           // Unix timestamp
    registeredAt: number;
    blockNumber: number;
    txHash: string;
    listing: {
      tokenId: string;
      name: string | null;
      seller: string;
      priceWei: string;
      currency: number;          // 0 = native, 1 = ERC-20 USDC
      blockNumber: number;
      updatedAt: string;         // ISO 8601
    } | null;
  }>
}
```

An expired name (`expiresAt < now`) still appears here if the token is owned — `ownerOf` reverts
past expiry but the internal mapping survives. The listing is present when the name is actively
listed for sale.

**Errors:**

- 400 — address is malformed or missing

### `GET /api/v1/domains/:name`

Full record for a single name — owner, expiry, registration timestamp, and active listing if one
exists.

**Parameters:**

| Name | Location | Required | Notes |
| --- | --- | --- | --- |
| `name` | Path | Yes | The label only |

**Response:**

Same shape as one item from `/domains?owner=`, without the wrapper:

```ts
{
  name: string;
  tokenId: string;
  owner: string;
  expiresAt: number;
  registeredAt: number;
  blockNumber: number;
  txHash: string;
  listing: { ... } | null;
}
```

**Errors:**

- 400 — name is invalid
- 404 — name has never been registered

The 404 is normal for a name that is available. Use `/availability` for the three-state answer.

### `GET /api/v1/marketplace?limit=50&cursor=<cursor>`

Active listings, paginated. Ordered by most recently updated.

**Parameters:**

| Name | Required | Default | Max | Notes |
| --- | --- | --- | --- | --- |
| `limit` | No | 50 | 200 | Items per page |
| `cursor` | No | — | — | Opaque token from a prior response's `nextCursor` |

**Response:**

```ts
{
  items: Array<{
    tokenId: string;
    name: string | null;       // null when the label was never recorded
    seller: string;
    priceWei: string;
    currency: number;          // 0 = native, 1 = ERC-20 USDC
    blockNumber: number;
    updatedAt: string;         // ISO 8601
  }>,
  nextCursor: string | null;   // present when there are more pages
}
```

To fetch the next page, pass the `nextCursor` value as the `cursor` parameter in the next request.
When `nextCursor` is null, you've reached the end.

Listings settle in either the native token or the 6-decimal ERC-20 USDC, indicated by `currency`.
The app only handles native (`currency: 0`) — filter accordingly if your integration does the same.

### `GET /api/v1/activity?limit=25&cursor=<cursor>&name=<label>`

Activity feed: registrations, renewals, transfers, listings, sales and unlistings. Paginated and
ordered by descending block number.

**Parameters:**

| Name | Required | Default | Max | Notes |
| --- | --- | --- | --- | --- |
| `limit` | No | 25 | 100 | Items per page |
| `cursor` | No | — | — | Opaque pagination token |
| `name` | No | — | — | Filter to one name (label only) |

**Response:**

```ts
{
  items: Array<{
    kind: 'registration' | 'renewal' | 'transfer' | 'listing' | 'sale' | 'unlisting';
    name: string | null;
    tokenId: string | null;
    actor: string | null;          // who initiated the event
    counterparty: string | null;   // for transfer/sale, the other side
    amountWei: string | null;      // for registration/renewal/sale
    blockNumber: number;
    txHash: string;
    at: string;                    // ISO 8601
  }>,
  nextCursor: string | null;
}
```

Not all fields are populated for every kind — a transfer has no `amountWei`, a listing has no
`counterparty`. Nullable fields will be null when inapplicable.

### `GET /api/v1/sync-status`

How far behind the indexer is, and whether it considers itself healthy. Use this to decide whether
to trust the data or to show a staleness warning.

**Parameters:** none

**Response:**

```ts
{
  indexedBlock: number;           // minimum across all streams
  chainHead: number | null;       // null when the RPC is unreachable from the indexer
  blocksBehind: number | null;    // chainHead - indexedBlock, or null
  checkpointAgeSeconds: number | null;  // time since the last reconcile pass completed
  healthy: boolean;               // false = too far behind to trust
  streams: Array<{
    stream: string;               // e.g. "registrar", "market"
    lastBlock: number;
    updatedAt: string;            // ISO 8601
  }>
}
```

`indexedBlock` is the **minimum** across streams, not the maximum — the indexer is only as fresh as
its furthest-behind stream, and the API reports the conservative bound.

`healthy` is false when:

- No streams are running.
- The last checkpoint is too old (`> 3 × reconcileIntervalMs`).
- The indexer is more than `staleAfterBlocks` behind the head (configured per deployment).

`checkpointAgeSeconds` is the liveness signal that doesn't depend on the RPC being reachable. If
the indexer can't reach the chain, `blocksBehind` becomes null but `checkpointAgeSeconds` will
climb — that's when it's truly stale.

### `GET /health`

Unversioned, returns HTTP 200 with `{"ok":true}` when the service is up. No authentication, meant
for load-balancer probes.

## Rate limits

Not currently enforced by the indexer itself. If deployed behind a reverse proxy or CDN, that layer
may apply its own limits.

## Errors

All errors return a JSON body:

```json
{
  "error": {
    "code": "not_found",
    "message": "alice has never been registered"
  }
}
```

| HTTP status | `code` | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Missing or malformed parameter |
| 404 | `not_found` | Name has never been registered |
| 500 | `internal_error` | Indexer fault |

## Caching

The indexer itself does not set cache headers. Responses reflect the database at request time, and
the database lags the chain by however many blocks `sync-status` reports.

For a client-side cache, treat listings and activity as stale after a few seconds. Names and
availability can be cached slightly longer, but always re-check before a transaction that moves
value.

## Example: paginating the marketplace

```ts
let cursor: string | null = null;
const allListings: Listing[] = [];

do {
  const params = new URLSearchParams({ limit: '200' });
  if (cursor) params.set('cursor', cursor);

  const response = await fetch(`/api/v1/marketplace?${params}`);
  const page = await response.json();

  allListings.push(...page.items);
  cursor = page.nextCursor;
} while (cursor !== null);
```

## Next

- [Resolving .arc](/protocol/resolving) — reading on-chain instead.
- [Contract addresses](/protocol/contracts) — the source of truth.
- [Glossary](/reference/glossary) — terms used throughout.
