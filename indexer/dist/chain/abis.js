import { ethers } from 'ethers';
/**
 * Log decoding.
 *
 * Signatures are transcribed from `src/ArcController.sol`, `src/ArcRegistrar.sol`
 * and `src/ArcMarket.sol`. Note that both the controller and the registrar emit
 * events named `NameRegistered`/`NameRenewed` with *different* signatures — the
 * controller's carry the human-readable label and the cost, the registrar's only
 * carry the token id. The indexer follows the controller's, because those are
 * the ones with the data an activity feed needs; they are distinguished by
 * topic0 rather than by name, so the two can never be confused.
 */
export const CONTROLLER_EVENTS = new ethers.Interface([
    'event NameRegistered(string name, bytes32 indexed label, address indexed owner, uint256 cost, uint256 expires)',
    'event NameRenewed(string name, bytes32 indexed label, uint256 cost, uint256 expires)',
]);
export const REGISTRAR_EVENTS = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 indexed id)',
]);
export const MARKET_EVENTS = new ethers.Interface([
    'event Listed(uint256 indexed id, address indexed seller, uint256 price)',
    'event PriceChanged(uint256 indexed id, address indexed seller, uint256 price)',
    'event Unlisted(uint256 indexed id, address indexed seller)',
    'event Sold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price, uint256 fee)',
]);
/** Read-only functions the indexer calls to fill in what the events omit. */
export const REGISTRAR_VIEW = new ethers.Interface([
    'function nameExpires(uint256 id) view returns (uint256)',
    'function ownerOf(uint256 id) view returns (address)',
]);
export const MARKET_VIEW = new ethers.Interface([
    'function listingCurrency(uint256 id) view returns (uint8)',
    'function getListing(uint256 id) view returns (address seller, uint256 price, bool active)',
]);
export const TOPICS = {
    NameRegistered: ethers.id('NameRegistered(string,bytes32,address,uint256,uint256)'),
    NameRenewed: ethers.id('NameRenewed(string,bytes32,uint256,uint256)'),
    Transfer: ethers.id('Transfer(address,address,uint256)'),
    Listed: ethers.id('Listed(uint256,address,uint256)'),
    PriceChanged: ethers.id('PriceChanged(uint256,address,uint256)'),
    Unlisted: ethers.id('Unlisted(uint256,address)'),
    Sold: ethers.id('Sold(uint256,address,address,uint256,uint256)'),
};
/** Grace period from `ArcRegistrar.GRACE` (90 days). Kept in one place. */
export const GRACE_PERIOD_SECONDS = 90 * 24 * 60 * 60;
/**
 * Token id for a label.
 *
 * `keccak256(label)` as an unsigned integer — matches `ArcRegistrar`, and must
 * stay byte-for-byte equivalent to the frontend's `labelToTokenId`, or the ids
 * this service stores will not join against the ones the contract emitted.
 */
export function labelToId(label) {
    return BigInt(ethers.keccak256(ethers.toUtf8Bytes(label))).toString();
}
/** Strips a trailing `.arc` and lowercases, so callers may pass either form. */
export function normalizeLabel(input) {
    return input.trim().toLowerCase().replace(/\.arc$/, '');
}
export function toFullName(label) {
    return `${normalizeLabel(label)}.arc`;
}
