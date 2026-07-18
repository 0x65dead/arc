// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/ArcENS.sol";
import "../src/ArcRegistrar.sol";
import "../src/ArcResolver.sol";
import "../src/ArcController.sol";

contract ArcTest is Test {
    ENSRegistry registry;
    ArcRegistrarU registrar;
    PublicResolverU resolver;
    ArcControllerU controller;

    address owner = address(this);

    function setUp() public {
        bytes32 baseLabel = keccak256("arc");
        bytes32 baseNode = keccak256(abi.encodePacked(bytes32(0), baseLabel));

        registry = new ENSRegistry();
        
        ArcRegistrarU registrarImpl = new ArcRegistrarU();
        bytes memory data = abi.encodeWithSelector(ArcRegistrarU.initialize.selector, address(registry), baseNode);
        ERC1967Proxy registrarProxy = new ERC1967Proxy(address(registrarImpl), data);
        registrar = ArcRegistrarU(payable(address(registrarProxy)));

        PublicResolverU resolverImpl = new PublicResolverU();
        data = abi.encodeWithSelector(PublicResolverU.initialize.selector, address(registry));
        ERC1967Proxy resolverProxy = new ERC1967Proxy(address(resolverImpl), data);
        resolver = PublicResolverU(address(resolverProxy));

        registry.setSubnodeOwner(0x0, baseLabel, address(registrar));

        ArcControllerU controllerImpl = new ArcControllerU();
        data = abi.encodeWithSelector(ArcControllerU.initialize.selector, address(registrar), address(registry), address(resolver), baseNode);
        ERC1967Proxy controllerProxy = new ERC1967Proxy(address(controllerImpl), data);
        controller = ArcControllerU(payable(address(controllerProxy)));

        registrar.addController(address(controller));
    }

    function testRegisterName() public {
        // Fast forward time so the initial maxCommitAge check passes
        vm.warp(10000000);

        string memory name = "testname";
        uint256 duration = 365 days;
        bytes32 secret = keccak256("secret");

        // Pay for the name (Mock native USDC balance)
        uint256 cost = controller.price(name, duration);
        vm.deal(address(this), cost);

        // Commit
        bytes32 commitment = controller.makeCommitment(name, address(this), secret);
        controller.commit(commitment);

        // Warp time forward past minCommitAge (60 seconds)
        vm.warp(block.timestamp + 61);

        // Reveal
        controller.register{value: cost}(name, address(this), duration, secret);

        // Assert ownership
        bytes32 label = keccak256(bytes(name));
        uint256 tokenId = uint256(label);
        assertEq(registrar.ownerOf(tokenId), address(this));
    }
}
