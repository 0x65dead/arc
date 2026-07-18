// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ENS} from "./interfaces/IENS.sol";
import {Initializable, UUPS, ERC1967Proxy} from "./libraries/UUPS.sol";

interface IERC721Receiver { function onERC721Received(address,address,uint256,bytes calldata) external returns (bytes4); }

abstract contract ERC721U {
    string public name; string public symbol;
    mapping(uint256 => address) internal _owners;
    mapping(address => uint256) internal _balances;
    mapping(uint256 => address) internal _approvals;
    mapping(address => mapping(address => bool)) internal _op;
    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed approved, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    
    function __erc721(string memory n, string memory s) internal { name = n; symbol = s; }
    function ownerOf(uint256 id) public view virtual returns (address o) { o = _owners[id]; require(o != address(0), "none"); }
    function balanceOf(address a) external view returns (uint256) { require(a != address(0)); return _balances[a]; }
    function approve(address to, uint256 id) external { address o = ownerOf(id); require(msg.sender == o || _op[o][msg.sender]); _approvals[id] = to; emit Approval(o, to, id); }
    function getApproved(uint256 id) external view returns (address) { return _approvals[id]; }
    function setApprovalForAll(address op, bool ok) external { _op[msg.sender][op] = ok; emit ApprovalForAll(msg.sender, op, ok); }
    function isApprovedForAll(address o, address op) public view returns (bool) { return _op[o][op]; }
    function _aoo(address s, uint256 id) internal view returns (bool) { address o = ownerOf(id); return s == o || _approvals[id] == s || _op[o][s]; }
    function transferFrom(address from, address to, uint256 id) public { require(_aoo(msg.sender, id)); require(ownerOf(id) == from); require(to != address(0)); _approvals[id] = address(0); _balances[from]--; _balances[to]++; _owners[id] = to; emit Transfer(from, to, id); }
    function safeTransferFrom(address from, address to, uint256 id) external { safeTransferFrom(from, to, id, ""); }
    function safeTransferFrom(address from, address to, uint256 id, bytes memory d) public { transferFrom(from, to, id); if (to.code.length > 0) require(IERC721Receiver(to).onERC721Received(msg.sender, from, id, d) == IERC721Receiver.onERC721Received.selector); }
    function _mint(address to, uint256 id) internal { require(_owners[id] == address(0)); _balances[to]++; _owners[id] = to; emit Transfer(address(0), to, id); }
    function _burn(uint256 id) internal { address o = _owners[id]; _approvals[id] = address(0); _balances[o]--; delete _owners[id]; emit Transfer(o, address(0), id); }
    function supportsInterface(bytes4 i) public view virtual returns (bool) { return i == 0x80ac58cd || i == 0x01ffc9a7 || i == 0x5b5e139f; }
}

library B64 {
    string internal constant _T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        string memory table = _T;
        uint256 encodedLen = 4 * ((data.length + 2) / 3);
        string memory result = new string(encodedLen + 32);
        assembly {
            mstore(result, encodedLen)
            let tablePtr := add(table, 1)
            let dataPtr := data
            let endPtr := add(dataPtr, mload(data))
            let resultPtr := add(result, 32)
            for {} lt(dataPtr, endPtr) {} {
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(18, input), 0x3F)))) resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(12, input), 0x3F)))) resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(6, input), 0x3F)))) resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(input, 0x3F)))) resultPtr := add(resultPtr, 1)
            }
            switch mod(mload(data), 3)
            case 1 { mstore8(sub(resultPtr, 1), 0x3d) mstore8(sub(resultPtr, 2), 0x3d) }
            case 2 { mstore8(sub(resultPtr, 1), 0x3d) }
        }
        return result;
    }
}

contract ArcRegistrarU is ERC721U, UUPS {
    ENS public ens;
    bytes32 public baseNode;
    address public owner;
    uint256 public constant GRACE = 90 days;
    mapping(uint256 => uint256) public expiries;
    mapping(address => bool) public controllers;
    string public baseURI;
    address public pendingOwner;
    mapping(uint256 => string) public labels;
    uint256[43] private __gap;

    event NameRegistered(uint256 indexed id, address indexed ownr, uint256 expires);
    event NameRenewed(uint256 indexed id, uint256 expires);
    event ControllerAdded(address indexed c);
    event ControllerRemoved(address indexed c);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    
    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }
    modifier onlyController() { require(controllers[msg.sender], "!controller"); _; }
    modifier live() { require(ens.owner(baseNode) == address(this), "!live"); _; }

    function initialize(address _ens, bytes32 _baseNode) external initializer {
        __erc721(".arc", "ARC"); ens = ENS(_ens); baseNode = _baseNode; owner = msg.sender;
    }
    
    function _authorizeUpgrade(address) internal view override onlyOwner {}
    function transferOwnership(address o) external onlyOwner { require(o != address(0), "0"); pendingOwner = o; emit OwnershipTransferStarted(owner, o); }
    function acceptOwnership() external { require(msg.sender == pendingOwner, "!pending"); emit OwnershipTransferred(owner, pendingOwner); owner = pendingOwner; pendingOwner = address(0); }
    function addController(address c) external onlyOwner { controllers[c] = true; emit ControllerAdded(c); }
    function removeController(address c) external onlyOwner { controllers[c] = false; emit ControllerRemoved(c); }
    function setBaseURI(string calldata u) external onlyOwner { baseURI = u; }
    function nameExpires(uint256 id) external view returns (uint256) { return expiries[id]; }
    function available(uint256 id) public view returns (bool) { return expiries[id] + GRACE < block.timestamp; }
    
    function register(uint256 id, address ownr, uint256 dur) external onlyController live returns (uint256) {
        require(available(id), "taken");
        expiries[id] = block.timestamp + dur;
        if (_owners[id] != address(0)) _burn(id);
        _mint(ownr, id); ens.setSubnodeOwner(baseNode, bytes32(id), ownr);
        emit NameRegistered(id, ownr, block.timestamp + dur); return block.timestamp + dur;
    }
    
    function renew(uint256 id, uint256 dur) external onlyController live returns (uint256) {
        require(expiries[id] + GRACE >= block.timestamp, "expired");
        expiries[id] = (expiries[id] > block.timestamp ? expiries[id] : block.timestamp) + dur;
        emit NameRenewed(id, expiries[id]); return expiries[id];
    }
    
    function reclaim(uint256 id, address ownr) external live { require(_aoo(msg.sender, id)); ens.setSubnodeOwner(baseNode, bytes32(id), ownr); }
    function ownerOf(uint256 id) public view override returns (address) { require(expiries[id] > block.timestamp, "expired"); return super.ownerOf(id); }
    
    function tokenURI(uint256 id) external view returns (string memory) {
        require(_owners[id] != address(0));
        string memory label = labels[id];
        if (bytes(label).length != 0) return _onchainURI(label);
        return bytes(baseURI).length == 0 ? "" : string(abi.encodePacked(baseURI, _s(id)));
    }
    
    function _s(uint256 v) internal pure returns (string memory) { if (v == 0) return "0"; uint256 t = v; uint256 d; while (t != 0) { d++; t /= 10; } bytes memory b = new bytes(d); while (v != 0) { d--; b[d] = bytes1(uint8(48 + v % 10)); v /= 10; } return string(b); }
    
    function recordLabel(string calldata label) public {
        uint256 id = uint256(keccak256(bytes(label)));
        require(_owners[id] != address(0), "!minted");
        require(_okLabel(label), "badlabel");
        labels[id] = label;
    }
    
    function recordLabels(string[] calldata ls) external { for (uint256 i; i < ls.length; i++) recordLabel(ls[i]); }
    
    function _okLabel(string calldata s) internal pure returns (bool) {
        bytes calldata b = bytes(s);
        if (b.length == 0 || b.length > 64) return false;
        for (uint256 i; i < b.length; i++) { bytes1 c = b[i]; if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d)) return false; }
        return true;
    }
    
    function _fs(uint256 total) internal pure returns (uint256) {
        if (total <= 9) return 188; if (total <= 12) return 150; if (total <= 16) return 116; if (total <= 22) return 84; return 62;
    }
    
    function renderSVG(string memory name) public pure returns (string memory) {
        uint256 fs = _fs(bytes(name).length + 5);
        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000" font-family="\'Helvetica Neue\',Arial,sans-serif">',
            '<defs><radialGradient id="g" cx="50%" cy="-8%" r="75%"><stop offset="0%" stop-color="#7DFF66" stop-opacity=".22"/><stop offset="55%" stop-color="#7DFF66" stop-opacity="0"/></radialGradient>',
            '<radialGradient id="g2" cx="85%" cy="88%" r="42%"><stop offset="0%" stop-color="#7DFF66" stop-opacity=".10"/><stop offset="70%" stop-color="#7DFF66" stop-opacity="0"/></radialGradient></defs>',
            '<rect width="1000" height="1000" fill="#070B08"/><rect width="1000" height="1000" fill="url(#g)"/><rect width="1000" height="1000" fill="url(#g2)"/>',
            '<svg x="64" y="58" width="72" height="72" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#7DFF66"/><path d="M18 46V22l14-5 14 5v24" stroke="#052A0E" stroke-width="4.4" fill="none" stroke-linejoin="round"/><path d="M27 46V35h10v11" stroke="#052A0E" stroke-width="4.4" fill="none" stroke-linejoin="round"/></svg>',
            '<text x="152" y="107" font-weight="800" font-size="40" fill="#EAF6EC">arc<tspan fill="#7DFF66">.</tspan></text>',
            '<text x="500" y="500" text-anchor="middle" dominant-baseline="central" font-weight="800" font-size="', _s(fs), '" letter-spacing="-3" fill="#EAF6EC">', name, '<tspan fill="#7DFF66">.arc</tspan></text>',
            '<text x="500" y="928" text-anchor="middle" font-weight="600" font-size="26" letter-spacing="8" fill="#7E9384">ARC BLOCKCHAIN</text>',
            '</svg>'
        ));
    }
    
    function _onchainURI(string memory label) internal pure returns (string memory) {
        string memory image = B64.encode(bytes(renderSVG(label)));
        string memory json = string(abi.encodePacked(
            '{"name":"', label, '.arc","description":"', label,
            '.arc - a fully on-chain name on the .arc name service, live on Arc Blockchain.",',
            '"image":"data:image/svg+xml;base64,', image, '"}'
        ));
        return string(abi.encodePacked('data:application/json;base64,', B64.encode(bytes(json))));
    }
}
