import { parseAbi } from 'viem';

/**
 * ABIs transcribed from the Solidity sources in `src/*.sol`, not from a
 * hand-maintained subset. Only the members this app actually calls are
 * included, but every signature here is byte-identical to the deployed one.
 *
 * Overloads are deliberately omitted where the app only ever uses one arity
 * (`register`, `buy`, `addr`, `setAddr`): including both halves of an
 * overload makes viem's argument inference ambiguous for no benefit, and the
 * referral/multi-coin variants are not exposed in this UI.
 */

export const controllerAbi = parseAbi([
  // --- reads ---
  'function available(string nm) view returns (bool)',
  'function valid(string nm) view returns (bool)',
  'function price(string nm, uint256 dur) view returns (uint256)',
  'function priceUSDC(string nm, uint256 dur) view returns (uint256)',
  'function usdPerYear(uint256 len) view returns (uint256)',
  'function labelOf(string nm) pure returns (bytes32)',
  'function makeCommitment(string nm, address o, bytes32 s) pure returns (bytes32)',
  'function commitments(bytes32) view returns (uint256)',
  'function minCommitAge() view returns (uint256)',
  'function maxCommitAge() view returns (uint256)',
  'function minLen() view returns (uint256)',
  'function price2() view returns (uint256)',
  'function price3() view returns (uint256)',
  'function price4() view returns (uint256)',
  'function price5plus() view returns (uint256)',
  // --- writes ---
  'function commit(bytes32 c)',
  'function register(string nm, address o, uint256 dur, bytes32 s) payable',
  'function renew(string nm, uint256 dur) payable',
  // --- events ---
  'event NameRegistered(string name, bytes32 indexed label, address indexed owner, uint256 cost, uint256 expires)',
  'event NameRenewed(string name, bytes32 indexed label, uint256 cost, uint256 expires)',
]);

export const registrarAbi = parseAbi([
  // --- reads ---
  'function ownerOf(uint256 id) view returns (address)',
  'function balanceOf(address a) view returns (uint256)',
  'function getApproved(uint256 id) view returns (address)',
  'function isApprovedForAll(address o, address op) view returns (bool)',
  'function nameExpires(uint256 id) view returns (uint256)',
  'function expiries(uint256 id) view returns (uint256)',
  'function available(uint256 id) view returns (bool)',
  'function labels(uint256 id) view returns (string)',
  'function tokenURI(uint256 id) view returns (string)',
  'function renderSVG(string name) pure returns (string)',
  'function GRACE() view returns (uint256)',
  // --- writes ---
  'function approve(address to, uint256 id)',
  'function setApprovalForAll(address op, bool ok)',
  'function transferFrom(address from, address to, uint256 id)',
  'function safeTransferFrom(address from, address to, uint256 id)',
  'function reclaim(uint256 id, address ownr)',
  'function recordLabel(string label)',
  // --- events ---
  // NOTE: the registrar emits its *own* NameRegistered, with a completely
  // different shape from the controller's. Decoding one with the other's ABI
  // silently yields garbage, so both are spelled out where they're used.
  'event Transfer(address indexed from, address indexed to, uint256 indexed id)',
  'event Approval(address indexed owner, address indexed approved, uint256 indexed id)',
  'event NameRegistered(uint256 indexed id, address indexed ownr, uint256 expires)',
  'event NameRenewed(uint256 indexed id, uint256 expires)',
]);

export const resolverAbi = parseAbi([
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string k) view returns (string)',
  'function name(bytes32 node) view returns (string)',
  'function contenthash(bytes32 node) view returns (bytes)',
  'function setAddr(bytes32 node, address a)',
  'function setText(bytes32 node, string k, string v)',
  'function setName(bytes32 node, string n)',
  'function setContenthash(bytes32 node, bytes h)',
  'event AddrChanged(bytes32 indexed node, address a)',
  'event TextChanged(bytes32 indexed node, string indexed key, string value)',
  'event NameChanged(bytes32 indexed node, string name)',
]);

export const registryAbi = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function recordExists(bytes32 node) view returns (bool)',
  'function setResolver(bytes32 node, address r)',
  'function setOwner(bytes32 node, address o)',
]);

export const marketAbi = parseAbi([
  // `getListing` is preferred over the raw `listings` mapping: it re-checks
  // that the seller still owns the token *and* that the market still holds an
  // approval, returning `active=false` otherwise. The previous UI read the
  // mapping directly, so a listing whose owner had since transferred the name
  // away (or revoked approval) still rendered as buyable and reverted on buy.
  'function getListing(uint256 id) view returns (address seller, uint256 price, bool active)',
  'function listings(uint256 id) view returns (address seller, uint256 price)',
  'function listingCurrency(uint256 id) view returns (uint8)',
  'function feeBps() view returns (uint256)',
  'function list(uint256 id, uint256 price)',
  'function setPrice(uint256 id, uint256 price)',
  'function unlist(uint256 id)',
  'function buy(uint256 id, uint256 maxPrice) payable',
  'event Listed(uint256 indexed id, address indexed seller, uint256 price)',
  'event PriceChanged(uint256 indexed id, address indexed seller, uint256 price)',
  'event Unlisted(uint256 indexed id, address indexed seller)',
  'event Sold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price, uint256 fee)',
]);

export const universalResolverAbi = parseAbi([
  'function resolve(string name) view returns (address)',
  'function reverse(address a) view returns (string name, bool verified)',
]);

export const reverseRegistrarAbi = parseAbi([
  'function node(address a) view returns (bytes32)',
  'function defaultResolver() view returns (address)',
  'function claim() returns (bytes32)',
]);

/** Marketplace listing currency discriminant (`listingCurrency` mapping). */
export const ListingCurrency = {
  Native: 0,
  USDC: 1,
} as const;
