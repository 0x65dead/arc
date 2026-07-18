// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IReg {
    function register(uint256, address, uint256) external returns (uint256);
    function renew(uint256, uint256) external returns (uint256);
    function reclaim(uint256, address) external;
    function transferFrom(address, address, uint256) external;
    function available(uint256) external view returns (bool);
}

interface IRes {
    function setAddr(bytes32, address) external;
}

interface IArcRegistrar {
    function ownerOf(uint256 id) external view returns (address);
    function getApproved(uint256 id) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function transferFrom(address from, address to, uint256 id) external;
    function reclaim(uint256 id, address owner) external;
    function nameExpires(uint256 id) external view returns (uint256);
}

interface IENSMarket {
    function setResolver(bytes32 node, address resolver) external;
}

interface IResolverMarket {
    function setAddr(bytes32 node, address a) external;
}
