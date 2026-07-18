// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ENS} from "./interfaces/IENS.sol";

contract ENSRegistry is ENS {
    struct Record { address owner; address resolver; uint64 ttl; }
    mapping(bytes32 => Record) records;
    mapping(address => mapping(address => bool)) operators;

    modifier authorised(bytes32 node) {
        address o = records[node].owner;
        require(o == msg.sender || operators[o][msg.sender], "ENS:!auth");
        _;
    }
    
    constructor() { records[0x0].owner = msg.sender; }

    function setRecord(bytes32 node, address o, address r, uint64 t) external { setOwner(node, o); _setResolverAndTTL(node, r, t); }
    function setSubnodeRecord(bytes32 node, bytes32 label, address o, address r, uint64 t) external {
        bytes32 sub = setSubnodeOwner(node, label, o); _setResolverAndTTL(sub, r, t);
    }
    function setOwner(bytes32 node, address o) public authorised(node) { records[node].owner = o; emit Transfer(node, o); }
    function setSubnodeOwner(bytes32 node, bytes32 label, address o) public authorised(node) returns (bytes32) {
        bytes32 sub = keccak256(abi.encodePacked(node, label));
        records[sub].owner = o; emit NewOwner(node, label, o); return sub;
    }
    function setResolver(bytes32 node, address r) public authorised(node) { records[node].resolver = r; emit NewResolver(node, r); }
    function setTTL(bytes32 node, uint64 t) public authorised(node) { records[node].ttl = t; emit NewTTL(node, t); }
    function _setResolverAndTTL(bytes32 node, address r, uint64 t) internal {
        if (r != records[node].resolver) { records[node].resolver = r; emit NewResolver(node, r); }
        if (t != records[node].ttl) { records[node].ttl = t; emit NewTTL(node, t); }
    }
    function setApprovalForAll(address op, bool ok) external { operators[msg.sender][op] = ok; emit ApprovalForAll(msg.sender, op, ok); }
    function owner(bytes32 node) public view returns (address) { address a = records[node].owner; return a == address(this) ? address(0) : a; }
    function resolver(bytes32 node) public view returns (address) { return records[node].resolver; }
    function ttl(bytes32 node) public view returns (uint64) { return records[node].ttl; }
    function recordExists(bytes32 node) public view returns (bool) { return records[node].owner != address(0); }
    function isApprovedForAll(address o, address op) external view returns (bool) { return operators[o][op]; }
}

contract ReverseRegistrar {
    ENS public immutable ens;
    bytes32 public immutable reverseNode;
    address public defaultResolver;
    address public owner;
    address public pendingOwner;

    event ReverseClaimed(address indexed addr, bytes32 indexed node);
    event DefaultResolverChanged(address resolver);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(ENS _ens, bytes32 _reverseNode, address _defaultResolver) {
        require(_defaultResolver != address(0), "0"); ens = _ens; reverseNode = _reverseNode; defaultResolver = _defaultResolver; owner = msg.sender;
    }
    
    function setDefaultResolver(address r) external { require(msg.sender == owner, "!owner"); require(r != address(0), "0"); defaultResolver = r; emit DefaultResolverChanged(r); }
    function transferOwnership(address o) external { require(msg.sender == owner, "!owner"); require(o != address(0), "0"); pendingOwner = o; emit OwnershipTransferStarted(owner, o); }
    function acceptOwnership() external { require(msg.sender == pendingOwner, "!pending"); emit OwnershipTransferred(owner, pendingOwner); owner = pendingOwner; pendingOwner = address(0); }

    function node(address a) public view returns (bytes32) { return keccak256(abi.encodePacked(reverseNode, sha3HexAddress(a))); }
    function claim() external returns (bytes32) { return _claimWithResolver(msg.sender, msg.sender, defaultResolver); }
    
    function _claimWithResolver(address a, address o, address r) internal returns (bytes32) {
        bytes32 label = sha3HexAddress(a);
        bytes32 nd = keccak256(abi.encodePacked(reverseNode, label));
        ens.setSubnodeRecord(reverseNode, label, o, r, 0);
        emit ReverseClaimed(a, nd); return nd;
    }
    
    function sha3HexAddress(address a) internal pure returns (bytes32 ret) {
        bytes16 hexc = 0x30313233343536373839616263646566;
        bytes memory s = new bytes(40); uint160 v = uint160(a);
        for (uint i = 0; i < 20; i++) { s[39 - i*2] = hexc[uint8(v & 0xf)]; v >>= 4; s[38 - i*2] = hexc[uint8(v & 0xf)]; v >>= 4; }
        return keccak256(s);
    }
}

interface IRegView { function resolver(bytes32 node) external view returns (address); }
interface IResView {
    function addr(bytes32 node) external view returns (address);
    function text(bytes32 node, string calldata key) external view returns (string memory);
    function name(bytes32 node) external view returns (string memory);
}

contract ArcUniversalResolver {
    IRegView public immutable registry;
    bytes32 public immutable addrReverseNode;

    constructor(address _registry, bytes32 _addrReverseNode) {
        registry = IRegView(_registry); addrReverseNode = _addrReverseNode;
    }

    function namehash(string memory name) public pure returns (bytes32 node) {
        bytes memory b = bytes(name);
        node = bytes32(0);
        uint256 end = b.length;
        int256 i = int256(b.length) - 1;
        while (true) {
            if (i < 0 || b[uint256(i)] == 0x2e) {
                uint256 start = uint256(i + 1);
                bytes32 labelhash = keccak256(_slice(b, start, end));
                node = keccak256(abi.encodePacked(node, labelhash));
                if (i < 0) break;
                end = uint256(i);
            }
            i--;
        }
    }
    
    function _slice(bytes memory b, uint256 s, uint256 e) internal pure returns (bytes memory out) {
        out = new bytes(e - s);
        for (uint256 k = 0; k < e - s; k++) out[k] = b[s + k];
    }

    function resolve(string calldata name) external view returns (address) {
        bytes32 node = namehash(name);
        address r = registry.resolver(node);
        if (r == address(0)) return address(0);
        return IResView(r).addr(node);
    }
    
    function reverse(address a) external view returns (string memory name, bool verified) {
        bytes32 rn = keccak256(abi.encodePacked(addrReverseNode, _sha3HexAddress(a)));
        address r = registry.resolver(rn);
        if (r == address(0)) return ("", false);
        name = IResView(r).name(rn);
        if (bytes(name).length == 0) return ("", false);
        bytes32 fnode = namehash(name);
        address fr = registry.resolver(fnode);
        verified = (fr != address(0) && IResView(fr).addr(fnode) == a);
    }
    
    function _sha3HexAddress(address a) internal pure returns (bytes32) {
        bytes16 hexc = 0x30313233343536373839616263646566;
        bytes memory s = new bytes(40); uint160 v = uint160(a);
        for (uint256 i = 0; i < 20; i++) { s[39 - i*2] = hexc[uint8(v & 0xf)]; v >>= 4; s[38 - i*2] = hexc[uint8(v & 0xf)]; v >>= 4; }
        return keccak256(s);
    }
}
