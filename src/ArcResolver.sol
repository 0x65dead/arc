// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ENS} from "./interfaces/IENS.sol";
import {Initializable, UUPS} from "./libraries/UUPS.sol";

contract PublicResolverU is UUPS {
    ENS public ens;
    address public owner;
    mapping(bytes32 => mapping(uint256 => bytes)) _addrs;
    mapping(bytes32 => mapping(string => string)) _texts;
    mapping(bytes32 => string) _names;
    mapping(bytes32 => bytes) _content;
    address public pendingOwner;
    uint256[44] private __gap; 
    uint256 constant ETH = 60;
    
    event AddrChanged(bytes32 indexed node, address a);
    event AddressChanged(bytes32 indexed node, uint256 coinType, bytes newAddress);
    event TextChanged(bytes32 indexed node, string indexed key, string value);
    event NameChanged(bytes32 indexed node, string name);
    event ContenthashChanged(bytes32 indexed node, bytes hash);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function initialize(address _ens) external initializer { ens = ENS(_ens); owner = msg.sender; }
    function _authorizeUpgrade(address) internal view override { require(msg.sender == owner, "!owner"); }
    
    function transferOwnership(address o) external { require(msg.sender == owner, "!owner"); require(o != address(0), "0"); pendingOwner = o; emit OwnershipTransferStarted(owner, o); }
    function acceptOwnership() external { require(msg.sender == pendingOwner, "!pending"); emit OwnershipTransferred(owner, pendingOwner); owner = pendingOwner; pendingOwner = address(0); }
    
    modifier auth(bytes32 node) { address o = ens.owner(node); require(o == msg.sender || ens.isApprovedForAll(o, msg.sender), "!auth"); _; }
    
    function setAddr(bytes32 node, address a) external auth(node) { _addrs[node][ETH] = abi.encodePacked(a); emit AddrChanged(node, a); emit AddressChanged(node, ETH, abi.encodePacked(a)); }
    function addr(bytes32 node) external view returns (address) { bytes memory b = _addrs[node][ETH]; if (b.length != 20) return address(0); return address(bytes20(b)); }
    function setAddr(bytes32 node, uint256 ct, bytes calldata a) external auth(node) { _addrs[node][ct] = a; emit AddressChanged(node, ct, a); }
    function addr(bytes32 node, uint256 ct) external view returns (bytes memory) { return _addrs[node][ct]; }
    function setText(bytes32 node, string calldata k, string calldata v) external auth(node) { _texts[node][k] = v; emit TextChanged(node, k, v); }
    function text(bytes32 node, string calldata k) external view returns (string memory) { return _texts[node][k]; }
    function setName(bytes32 node, string calldata n) external auth(node) { _names[node] = n; emit NameChanged(node, n); }
    function name(bytes32 node) external view returns (string memory) { return _names[node]; }
    function setContenthash(bytes32 node, bytes calldata h) external auth(node) { _content[node] = h; emit ContenthashChanged(node, h); }
    function contenthash(bytes32 node) external view returns (bytes memory) { return _content[node]; }
    function supportsInterface(bytes4 i) external pure returns (bool) { return i == 0x01ffc9a7 || i == 0x3b3b57de || i == 0xf1cb7e06 || i == 0x59d1d43c || i == 0x691f3431 || i == 0xbc1c58d1; }
}
