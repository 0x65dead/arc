// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IArcRegistrar, IENSMarket, IResolverMarket} from "./interfaces/IRegistrar.sol";
import {IERC20P} from "./interfaces/IERC20P.sol";
import {Initializable, UUPS} from "./libraries/UUPS.sol";

contract ArcMarketU is UUPS {
    IArcRegistrar public registrar;
    address public owner;
    address public feeRecipient;
    uint256 public feeBps; 
    uint256 private _lock; 

    struct Listing { address seller; uint256 price; } 
    mapping(uint256 => Listing) public listings; 

    address public pendingOwner; 
    IENSMarket public ensRegistry; 
    address public resolver; 
    bytes32 public baseNode; 
    mapping(address => uint256) public pendingWithdrawals; 

    uint256 public refDiscountBps; 
    uint256 public refRewardBps; 
    address public usdc; 
    mapping(uint256 => uint8) public listingCurrency; 
    mapping(address => uint256) public pendingUSDC; 
    uint256[35] private __gap; 

    event Listed(uint256 indexed id, address indexed seller, uint256 price);
    event PriceChanged(uint256 indexed id, address indexed seller, uint256 price);
    event Unlisted(uint256 indexed id, address indexed seller);
    event Sold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price, uint256 fee);
    event FeeChanged(uint256 feeBps, address feeRecipient);
    event ResolverConfigChanged(address ens, address resolver, bytes32 baseNode);
    event Withdrawn(address indexed to, uint256 amount);
    event WithdrawnUSDC(address indexed to, uint256 amount);
    event UsdcSet(address indexed usdc);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MarketReferralChanged(uint256 discountBps, uint256 rewardBps);
    event ReferralPaid(uint256 indexed id, address indexed referrer, address indexed referee, uint256 reward);

    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }
    modifier nonReentrant() { require(_lock == 0, "reentrant"); _lock = 1; _; _lock = 0; }

    function initialize(address _registrar) external initializer {
        require(_registrar != address(0), "registrar");
        registrar = IArcRegistrar(_registrar); owner = msg.sender; feeRecipient = msg.sender; feeBps = 0;
    }
    
    function _authorizeUpgrade(address) internal view override onlyOwner {}

    function list(uint256 id, uint256 price) external {
        require(price > 0, "price");
        require(registrar.ownerOf(id) == msg.sender, "!owner");
        require(_approved(id, msg.sender), "!approved");
        listings[id] = Listing(msg.sender, price); listingCurrency[id] = 0;
        emit Listed(id, msg.sender, price);
    }
    
    function listUSDC(uint256 id, uint256 price) external {
        require(price > 0, "price"); require(usdc != address(0), "usdc off");
        require(registrar.ownerOf(id) == msg.sender, "!owner");
        require(_approved(id, msg.sender), "!approved");
        listings[id] = Listing(msg.sender, price); listingCurrency[id] = 1;
        emit Listed(id, msg.sender, price);
    }

    function setPrice(uint256 id, uint256 price) external {
        require(price > 0, "price"); Listing storage l = listings[id];
        require(l.seller == msg.sender, "!seller"); l.price = price;
        emit PriceChanged(id, msg.sender, price);
    }
    
    function unlist(uint256 id) external {
        require(listings[id].seller == msg.sender, "!seller");
        delete listings[id]; delete listingCurrency[id];
        emit Unlisted(id, msg.sender);
    }

    function buy(uint256 id, uint256 maxPrice) external payable nonReentrant { _buy(id, maxPrice, address(0)); }
    function buy(uint256 id) external payable nonReentrant { _buy(id, msg.value, address(0)); }
    function buy(uint256 id, uint256 maxPrice, address referrer) external payable nonReentrant { _buy(id, maxPrice, referrer); }

    function _buy(uint256 id, uint256 maxPrice, address referrer) internal {
        Listing memory l = listings[id];
        require(l.seller != address(0), "!listed");
        require(listingCurrency[id] == 0, "usdc listing"); 
        require(l.price <= maxPrice, "price moved"); 
        require(registrar.ownerOf(id) == l.seller, "seller changed"); 

        uint256 fee = l.price * feeBps / 10000;
        uint256 proceeds = l.price - fee; 

        uint256 discount; uint256 reward;
        if (referrer != address(0) && referrer != msg.sender && referrer != l.seller && (refDiscountBps > 0 || refRewardBps > 0)) {
            discount = l.price * refDiscountBps / 10000; reward = l.price * refRewardBps / 10000;
            if (discount + reward > fee) { discount = 0; reward = 0; } 
        }
        uint256 due = l.price - discount; 
        require(msg.value >= due, "underpaid");

        delete listings[id];
        try this._finalizeName(id, msg.sender) {} catch { registrar.reclaim(id, msg.sender); }
        registrar.transferFrom(l.seller, msg.sender, id);

        _pay(l.seller, proceeds);
        if (reward > 0) {
            (bool rok,) = referrer.call{value: reward}("");
            if (!rok) pendingWithdrawals[referrer] += reward;
            emit ReferralPaid(id, referrer, msg.sender, reward);
        }
        uint256 treasuryCut = fee - discount - reward;
        if (treasuryCut > 0) _pay(feeRecipient, treasuryCut);
        if (msg.value > due) _pay(msg.sender, msg.value - due);

        emit Sold(id, l.seller, msg.sender, l.price, fee);
    }

    function _finalizeName(uint256 id, address buyer) external {
        require(msg.sender == address(this), "self");
        if (address(ensRegistry) != address(0) && resolver != address(0) && baseNode != bytes32(0)) {
            bytes32 node = keccak256(abi.encodePacked(baseNode, bytes32(id)));
            registrar.reclaim(id, address(this));
            ensRegistry.setResolver(node, resolver);
            IResolverMarket(resolver).setAddr(node, buyer);
        }
        registrar.reclaim(id, buyer);
    }
    
    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) pendingWithdrawals[to] += amount; 
    }

    function setUsdc(address u) external onlyOwner { usdc = u; emit UsdcSet(u); }
    struct USDCPermit { uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s; }
    
    function _applyPermit(USDCPermit calldata p) internal {
        if (p.deadline != 0) IERC20P(usdc).permit(msg.sender, address(this), p.value, p.deadline, p.v, p.r, p.s);
    }
    function _usdcPull(address from, uint256 amt) internal {
        require(usdc.code.length > 0, "usdc"); 
        (bool ok, bytes memory d) = usdc.call(abi.encodeWithSelector(IERC20P.transferFrom.selector, from, address(this), amt));
        require(ok && (d.length == 0 || abi.decode(d, (bool))), "usdc pull");
    }
    function _usdcPay(address to, uint256 amt) internal returns (bool) {
        (bool ok, bytes memory d) = usdc.call(abi.encodeWithSelector(IERC20P.transfer.selector, to, amt));
        return ok && (d.length == 0 || abi.decode(d, (bool)));
    }
    function _payUSDC(address to, uint256 amt) internal { if (amt == 0) return; if (!_usdcPay(to, amt)) pendingUSDC[to] += amt; }
    
    function buyUSDC(uint256 id, uint256 maxUsdc, address referrer, USDCPermit calldata p) external nonReentrant {
        require(usdc != address(0), "usdc off");
        Listing memory l = listings[id];
        require(l.seller != address(0), "!listed"); require(listingCurrency[id] == 1, "not usdc");
        require(l.price <= maxUsdc, "price moved"); require(registrar.ownerOf(id) == l.seller, "seller changed");
        uint256 fee = l.price * feeBps / 10000; uint256 proceeds = l.price - fee;
        uint256 discount; uint256 reward;
        if (referrer != address(0) && referrer != msg.sender && referrer != l.seller && (refDiscountBps > 0 || refRewardBps > 0)) {
            discount = l.price * refDiscountBps / 10000; reward = l.price * refRewardBps / 10000;
            if (discount + reward > fee) { discount = 0; reward = 0; }
        }
        uint256 due = l.price - discount; 
        delete listings[id]; delete listingCurrency[id];
        _applyPermit(p); _usdcPull(msg.sender, due); 
        try this._finalizeName(id, msg.sender) {} catch { registrar.reclaim(id, msg.sender); }
        registrar.transferFrom(l.seller, msg.sender, id);
        _payUSDC(l.seller, proceeds);
        if (reward > 0) { if (!_usdcPay(referrer, reward)) pendingUSDC[referrer] += reward; emit ReferralPaid(id, referrer, msg.sender, reward); }
        _payUSDC(feeRecipient, fee - discount - reward); 
        emit Sold(id, l.seller, msg.sender, l.price, fee);
    }
    
    function withdrawPendingUSDC() external nonReentrant {
        uint256 amt = pendingUSDC[msg.sender]; require(amt > 0, "none");
        pendingUSDC[msg.sender] = 0; require(_usdcPay(msg.sender, amt), "withdraw"); emit WithdrawnUSDC(msg.sender, amt);
    }
    function withdrawPending() external nonReentrant {
        uint256 amt = pendingWithdrawals[msg.sender]; require(amt > 0, "none");
        pendingWithdrawals[msg.sender] = 0; (bool ok,) = msg.sender.call{value: amt}(""); require(ok, "withdraw"); emit Withdrawn(msg.sender, amt);
    }

    function getListing(uint256 id) external view returns (address seller, uint256 price, bool active) {
        Listing memory l = listings[id]; seller = l.seller; price = l.price;
        if (seller == address(0)) return (seller, price, false);
        try registrar.ownerOf(id) returns (address o) { active = (o == seller) && _approved(id, seller); } catch { active = false; }
    }
    function _approved(uint256 id, address holder) internal view returns (bool) {
        return registrar.getApproved(id) == address(this) || registrar.isApprovedForAll(holder, address(this));
    }

    function setFee(uint256 bps, address recipient) external onlyOwner {
        require(bps <= 1000, "max10%"); require(recipient != address(0), "recipient");
        feeBps = bps; feeRecipient = recipient;
        if (refDiscountBps + refRewardBps > bps) { refDiscountBps = 0; refRewardBps = 0; emit MarketReferralChanged(0, 0); }
        emit FeeChanged(bps, recipient);
    }
    function setMarketReferral(uint256 discountBps, uint256 rewardBps) external onlyOwner {
        require(discountBps + rewardBps <= feeBps, "exceeds fee");
        refDiscountBps = discountBps; refRewardBps = rewardBps; emit MarketReferralChanged(discountBps, rewardBps);
    }
    function setResolverConfig(address _ens, address _resolver, bytes32 _baseNode) external onlyOwner {
        ensRegistry = IENSMarket(_ens); resolver = _resolver; baseNode = _baseNode; emit ResolverConfigChanged(_ens, _resolver, _baseNode);
    }
    function transferOwnership(address o) external onlyOwner { require(o != address(0), "0"); pendingOwner = o; emit OwnershipTransferStarted(owner, o); }
    function acceptOwnership() external { require(msg.sender == pendingOwner, "!pending"); emit OwnershipTransferred(owner, pendingOwner); owner = pendingOwner; pendingOwner = address(0); }
}
