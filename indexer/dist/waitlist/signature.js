import { ethers } from 'ethers';
import { provider } from '../chain/provider.js';
import { createLogger } from '../logger.js';
const log = createLogger('siwe');
/**
 * Wallet ownership proof.
 *
 * A plain "sign this text" challenge, in the spirit of EIP-4361 but without
 * the dependency — the parts of SIWE that matter here are the ones that stop a
 * signature being reused or repurposed, and those are properties of the
 * message the server issues, not of the parsing library:
 *
 *   - a server-issued nonce, stored and single-use, so a captured signature
 *     cannot be replayed;
 *   - the address stated in the message, so a signature for one wallet cannot
 *     be presented as another's;
 *   - the domain and purpose stated in plain language, so a signature phished
 *     by a different site is visibly for something else;
 *   - an issue time, so a stale challenge is refusable.
 *
 * Every one of those is checked below against the stored copy of the message,
 * not against a re-parse of the string the client sent back.
 */
export function buildSignInMessage(params) {
    // A wallet renders this verbatim in the signing dialog. It is written to be
    // read by a person deciding whether to approve, which is the only real
    // defence against a signature request they did not intend to make: the two
    // facts that matter are that nothing here can move funds, and which site is
    // asking.
    return [
        `${params.domain} wants you to sign in with your Arc wallet.`,
        '',
        'Signing proves you control this address so it can be added to the Arc',
        'Names mainnet waitlist. This is a signature, not a transaction: it costs',
        'no gas and cannot move your funds or your names.',
        '',
        `Address: ${ethers.getAddress(params.address)}`,
        `Nonce: ${params.nonce}`,
        `Issued At: ${params.issuedAt.toISOString()}`,
        `Expires At: ${params.expiresAt.toISOString()}`,
    ].join('\n');
}
/**
 * Verifies `signature` over `message` for `address`.
 *
 * Two paths, tried in order:
 *
 *  1. ECDSA recovery — an ordinary EOA (MetaMask, Rabby, a hardware wallet).
 *  2. EIP-1271 `isValidSignature` — a smart contract account, where there is
 *     no key to recover and the contract itself is the authority on what
 *     counts as a valid signature.
 *
 * Without the second path every Safe and every smart account is told their
 * signature is invalid, which looks like a bug in the wallet rather than an
 * unsupported account type.
 */
export async function verifySignature(address, message, signature) {
    const expected = address.toLowerCase();
    try {
        if (ethers.verifyMessage(message, signature).toLowerCase() === expected)
            return true;
    }
    catch {
        // Malformed signature, or one produced by a contract account — neither is
        // conclusive on its own, so fall through to the 1271 check rather than
        // rejecting here.
    }
    return verifyErc1271(address, message, signature);
}
const ERC1271_ABI = [
    'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
];
/** `bytes4(keccak256("isValidSignature(bytes32,bytes)"))` — the magic value. */
const ERC1271_MAGIC = '0x1626ba7e';
async function verifyErc1271(address, message, signature) {
    try {
        const code = await provider.getCode(address);
        // No code at the address means it is an EOA, and the recovery above
        // already had its say. Calling on an EOA would revert anyway.
        if (code === '0x')
            return false;
        const contract = new ethers.Contract(address, ERC1271_ABI, provider);
        const result = await contract.isValidSignature(ethers.hashMessage(message), signature);
        return String(result).toLowerCase() === ERC1271_MAGIC;
    }
    catch (error) {
        // A contract that does not implement 1271 reverts here. That is a failed
        // verification, not a server fault — log at debug and refuse.
        log.debug('erc-1271 verification failed', { address, error });
        return false;
    }
}
