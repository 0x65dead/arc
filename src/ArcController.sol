// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ENS} from "./interfaces/IENS.sol";
import {IReg, IRes} from "./interfaces/IRegistrar.sol";
import {IERC20P} from "./interfaces/IERC20P.sol";
import {Initializable, UUPS} from "./libraries/UUPS.sol";

contract ArcControllerU is UUPS {
    IReg public registrar; ENS public ens; IRes public resolver; bytes32 public baseNode;
    address public owner;
    uint256 public minCommitAge; uint256 public maxCommitAge; uint256 public minLen;
    uint256 public price2; uint256 public price3; uint256 public price4; uint256 public price5plus; 
    mapping(bytes32 => uint256) public commitments;
    
    uint256 private _lock; 
    address public pendingOwner; 
    uint256 public refDiscountBps; 
    uint256 public refRewardBps; 
    mapping(address => uint256) public pendingWithdrawals; 
    uint256 public totalPending; 
    address public usdc; 
    mapping(address => uint256) public pendingUSDC; 
    uint256 public totalPendingUSDC;
    uint256[40] private __gap;

    uint256 public constant MIN_DURATION = 28 days;
    uint256 public constant MAX_DURATION = 36500 days;

    event NameRegistered(string name, bytes32 indexed label, address indexed owner, uint256 cost, uint256 expires);
    event NameRenewed(string name, bytes32 indexed label, uint256 cost, uint256 expires);
    event PricesChanged(uint256 price2, uint256 price3, uint256 price4, uint256 price5plus);
    event LimitsChanged(uint256 minCommitAge, uint256 maxCommitAge, uint256 minLen);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ReferralChanged(uint256 discountBps, uint256 rewardBps);
    event ReferralPaid(address indexed referrer, address indexed referee, uint256 reward);
    event Withdrawn(address indexed to, uint256 amount);
    event UsdcSet(address indexed usdc);
    event WithdrawnUSDC(address indexed to, uint256 amount);
    event ReferralPaidUSDC(address indexed referrer, address indexed referee, uint256 reward);
    
    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }
    modifier nonReentrant() { require(_lock == 0, "reentrant"); _lock = 1; _; _lock = 0; }

    function initialize(address _r, address _ens, address _res, bytes32 _base) external initializer {
        registrar = IReg(_r); ens = ENS(_ens); resolver = IRes(_res); baseNode = _base; owner = msg.sender;
        minCommitAge = 60; maxCommitAge = 86400; minLen = 2;
        price2 = 2e18; price3 = 640e18; price4 = 160e18; price5plus = 5e18;
    }
    
    function _authorizeUpgrade(address) internal view override onlyOwner {}
    function transferOwnership(address o) external onlyOwner { require(o != address(0), "0"); pendingOwner = o; emit OwnershipTransferStarted(owner, o); }
    function acceptOwnership() external { require(msg.sender == pendingOwner, "!pending"); emit OwnershipTransferred(owner, pendingOwner); owner = pendingOwner; pendingOwner = address(0); }
    
    function setPrices(uint256 p2, uint256 p3, uint256 p4, uint256 p5) external onlyOwner { price2 = p2; price3 = p3; price4 = p4; price5plus = p5; emit PricesChanged(p2, p3, p4, p5); }
    function setReferral(uint256 discountBps, uint256 rewardBps) external onlyOwner {
        require(discountBps <= 2000 && rewardBps <= 2000, "bps");
        refDiscountBps = discountBps; refRewardBps = rewardBps; emit ReferralChanged(discountBps, rewardBps);
    }
    function setLimits(uint256 a, uint256 b, uint256 l) external onlyOwner { require(l >= 2, "minLen"); require(a <= b, "commitAge"); minCommitAge = a; maxCommitAge = b; minLen = l; emit LimitsChanged(a, b, l); }
    
    function withdraw(address to) external onlyOwner { require(to != address(0), "0"); (bool ok,) = to.call{value: address(this).balance - totalPending}(""); require(ok); }
    function withdrawPending() external nonReentrant {
        uint256 amt = pendingWithdrawals[msg.sender]; require(amt > 0, "none");
        pendingWithdrawals[msg.sender] = 0; totalPending -= amt;
        (bool ok,) = msg.sender.call{value: amt}(""); require(ok, "withdraw"); emit Withdrawn(msg.sender, amt);
    }
    
    function setUsdc(address u) external onlyOwner { usdc = u; emit UsdcSet(u); }
    function _usdcPull(address from, uint256 amt) internal {
        require(usdc.code.length > 0, "usdc"); 
        (bool ok, bytes memory d) = usdc.call(abi.encodeWithSelector(IERC20P.transferFrom.selector, from, address(this), amt));
        require(ok && (d.length == 0 || abi.decode(d, (bool))), "usdc pull");
    }
    function _usdcPay(address to, uint256 amt) internal returns (bool) {
        (bool ok, bytes memory d) = usdc.call(abi.encodeWithSelector(IERC20P.transfer.selector, to, amt));
        return ok && (d.length == 0 || abi.decode(d, (bool)));
    }
    function priceUSDC(string memory nm, uint256 dur) public view returns (uint256) { return price(nm, dur) / 1e12; }
    function withdrawUSDC(address to) external onlyOwner {
        require(to != address(0), "0"); require(usdc != address(0), "usdc off");
        uint256 amt = IERC20P(usdc).balanceOf(address(this)) - totalPendingUSDC;
        require(_usdcPay(to, amt), "withdraw"); emit WithdrawnUSDC(to, amt);
    }
    function withdrawPendingUSDC() external nonReentrant {
        uint256 amt = pendingUSDC[msg.sender]; require(amt > 0, "none");
        pendingUSDC[msg.sender] = 0; totalPendingUSDC -= amt;
        require(_usdcPay(msg.sender, amt), "withdraw"); emit WithdrawnUSDC(msg.sender, amt);
    }
    
    function labelOf(string memory nm) public pure returns (bytes32) { return keccak256(bytes(nm)); }
    function valid(string memory nm) public view returns (bool) {
        bytes memory b = bytes(nm); uint256 len = b.length;
        if (len < minLen) return false;
        if (len == 2 && price2 == 0) return false;
        for (uint256 i = 0; i < len; i++) { uint8 c = uint8(b[i]); if (c >= 0x41 && c <= 0x5a) return false; }
        return true;
    }
    function available(string calldata nm) external view returns (bool) { return valid(nm) && registrar.available(uint256(labelOf(nm))); }
    function usdPerYear(uint256 len) public view returns (uint256) { require(len >= minLen, "short"); if (len == 2) { require(price2 > 0, "2char"); return price2; } if (len == 3) return price3; if (len == 4) return price4; return price5plus; }
    
    // 1 native wei = 1e-18 USDC. 1 USD price = 1e18 scale. So price() = USD price directly in native wei.
    function price(string memory nm, uint256 dur) public view returns (uint256) { return usdPerYear(bytes(nm).length) * dur / 365 days; }
    
    function makeCommitment(string calldata nm, address o, bytes32 s) public pure returns (bytes32) { return keccak256(abi.encode(labelOf(nm), o, s)); }
    function commit(bytes32 c) external { require(commitments[c] + maxCommitAge < block.timestamp, "committed"); commitments[c] = block.timestamp; }
    
    function register(string calldata nm, address o, uint256 dur, bytes32 s) external payable nonReentrant { _doRegister(nm, o, dur, s, address(0)); }
    function register(string calldata nm, address o, uint256 dur, bytes32 s, address referrer) external payable nonReentrant { _doRegister(nm, o, dur, s, referrer); }
    
    function _doRegister(string calldata nm, address o, uint256 dur, bytes32 s, address referrer) internal {
        require(o != address(0), "owner");
        bytes32 c = makeCommitment(nm, o, s);
        require(commitments[c] + minCommitAge <= block.timestamp, "early");
        require(commitments[c] + maxCommitAge > block.timestamp, "commit expired");
        require(valid(nm), "invalid");
        require(dur >= MIN_DURATION && dur <= MAX_DURATION, "duration");
        (uint256 due, uint256 reward) = _quote(nm, dur, o, referrer);
        require(msg.value >= due, "underpaid");
        delete commitments[c];
        _mint(nm, o, dur, due);
        if (reward > 0) {
            (bool rok,) = referrer.call{value: reward}("");
            if (!rok) { pendingWithdrawals[referrer] += reward; totalPending += reward; }
            emit ReferralPaid(referrer, msg.sender, reward);
        }
        if (msg.value > due) { (bool ok,) = msg.sender.call{value: msg.value - due}(""); require(ok); }
    }
    
    function _quote(string calldata nm, uint256 dur, address o, address referrer) internal view returns (uint256 due, uint256 reward) {
        uint256 baseCost = price(nm, dur); due = baseCost;
        if (referrer != address(0) && referrer != msg.sender && referrer != o && (refDiscountBps > 0 || refRewardBps > 0)) {
            due = baseCost - (baseCost * refDiscountBps / 10000); reward = baseCost * refRewardBps / 10000;
        }
    }
    
    function _mint(string calldata nm, address o, uint256 dur, uint256 due) internal {
        bytes32 label = labelOf(nm); uint256 id = uint256(label);
        registrar.register(id, address(this), dur);
        bytes32 node = keccak256(abi.encodePacked(baseNode, label));
        ens.setResolver(node, address(resolver)); resolver.setAddr(node, o);
        registrar.reclaim(id, o); registrar.transferFrom(address(this), o, id);
        emit NameRegistered(nm, label, o, due, block.timestamp + dur);
    }
    
    function registerMany(string[] calldata names, address o, uint256 dur, address referrer) external payable nonReentrant {
        require(o != address(0), "owner"); uint256 n = names.length; require(n > 0 && n <= 20, "count");
        require(dur >= MIN_DURATION && dur <= MAX_DURATION, "duration");
        uint256 totalDue; uint256 totalReward; uint256[] memory dues = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            require(valid(names[i]), "invalid");
            (uint256 due, uint256 reward) = _quote(names[i], dur, o, referrer);
            dues[i] = due; totalDue += due; totalReward += reward;
        }
        require(msg.value >= totalDue, "underpaid");
        for (uint256 i = 0; i < n; i++) { _mint(names[i], o, dur, dues[i]); }
        if (totalReward > 0) {
            (bool rok,) = referrer.call{value: totalReward}("");
            if (!rok) { pendingWithdrawals[referrer] += totalReward; totalPending += totalReward; }
            emit ReferralPaid(referrer, msg.sender, totalReward);
        }
        if (msg.value > totalDue) { (bool ok,) = msg.sender.call{value: msg.value - totalDue}(""); require(ok); }
    }
    
    function renew(string calldata nm, uint256 dur) external payable nonReentrant {
        require(dur >= MIN_DURATION && dur <= MAX_DURATION, "duration");
        uint256 cost = price(nm, dur); require(msg.value >= cost, "underpaid");
        bytes32 label = labelOf(nm); uint256 exp = registrar.renew(uint256(label), dur);
        if (msg.value > cost) { (bool ok,) = msg.sender.call{value: msg.value - cost}(""); require(ok); }
        emit NameRenewed(nm, label, cost, exp);
    }

    struct USDCPermit { uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s; }
    function _applyPermit(USDCPermit calldata p) internal {
        if (p.deadline != 0) IERC20P(usdc).permit(msg.sender, address(this), p.value, p.deadline, p.v, p.r, p.s);
    }
    function _sumUSDC(string[] calldata names, address o, uint256 dur, address referrer) internal view returns (uint256 totalDue, uint256 totalReward) {
        bool ref = referrer != address(0) && referrer != msg.sender && referrer != o && (refDiscountBps > 0 || refRewardBps > 0);
        for (uint256 i = 0; i < names.length; i++) {
            require(valid(names[i]), "invalid"); uint256 base = priceUSDC(names[i], dur); uint256 due = base;
            if (ref) { due = base - base * refDiscountBps / 10000; totalReward += base * refRewardBps / 10000; }
            totalDue += due;
        }
    }
    function registerManyUSDC(string[] calldata names, address o, uint256 dur, address referrer, USDCPermit calldata p) external nonReentrant {
        require(o != address(0), "owner"); require(usdc != address(0), "usdc off"); uint256 n = names.length; require(n > 0 && n <= 20, "count");
        require(dur >= MIN_DURATION && dur <= MAX_DURATION, "duration");
        (uint256 totalDue, uint256 totalReward) = _sumUSDC(names, o, dur, referrer);
        _applyPermit(p); _usdcPull(msg.sender, totalDue);
        for (uint256 i = 0; i < n; i++) { _mint(names[i], o, dur, price(names[i], dur)); }
        if (totalReward > 0) {
            if (!_usdcPay(referrer, totalReward)) { pendingUSDC[referrer] += totalReward; totalPendingUSDC += totalReward; }
            emit ReferralPaidUSDC(referrer, msg.sender, totalReward);
        }
    }
    function renewUSDC(string calldata nm, uint256 dur, USDCPermit calldata p) external nonReentrant {
        require(usdc != address(0), "usdc off"); require(dur >= MIN_DURATION && dur <= MAX_DURATION, "duration");
        uint256 cost = priceUSDC(nm, dur); _applyPermit(p); _usdcPull(msg.sender, cost);
        bytes32 label = labelOf(nm); uint256 exp = registrar.renew(uint256(label), dur);
        emit NameRenewed(nm, label, price(nm, dur), exp);
    }
    receive() external payable {}
}
