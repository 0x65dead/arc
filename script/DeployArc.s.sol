// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/ArcENS.sol";
import "../src/ArcRegistrar.sol";
import "../src/ArcResolver.sol";
import "../src/ArcController.sol";
import "../src/ArcMarket.sol";

contract DeployArc is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        bytes32 baseLabel = keccak256("arc");
        bytes32 baseNode = keccak256(abi.encodePacked(bytes32(0), baseLabel));

        // 1. Deploy ENS Registry
        ENSRegistry registry = new ENSRegistry();
        
        // 2. Deploy ArcRegistrar Implementation and Proxy
        ArcRegistrarU registrarImpl = new ArcRegistrarU();
        bytes memory data = abi.encodeWithSelector(ArcRegistrarU.initialize.selector, address(registry), baseNode);
        ERC1967Proxy registrarProxy = new ERC1967Proxy(address(registrarImpl), data);
        ArcRegistrarU registrar = ArcRegistrarU(address(registrarProxy));

        // 3. Deploy Public Resolver Implementation and Proxy
        PublicResolverU resolverImpl = new PublicResolverU();
        data = abi.encodeWithSelector(PublicResolverU.initialize.selector, address(registry));
        ERC1967Proxy resolverProxy = new ERC1967Proxy(address(resolverImpl), data);
        PublicResolverU resolver = PublicResolverU(address(resolverProxy));

        // 4. Set up registry to point "arc" base node to registrar
        registry.setSubnodeOwner(0x0, baseLabel, address(registrar));

        // 5. Deploy Arc Controller Implementation and Proxy
        ArcControllerU controllerImpl = new ArcControllerU();
        data = abi.encodeWithSelector(ArcControllerU.initialize.selector, address(registrar), address(registry), address(resolver), baseNode);
        ERC1967Proxy controllerProxy = new ERC1967Proxy(address(controllerImpl), data);
        ArcControllerU controller = ArcControllerU(payable(address(controllerProxy)));

        // 6. Give controller permission on registrar
        registrar.addController(address(controller));

        // 7. Deploy Reverse Registrar
        bytes32 reverseLabel = keccak256("reverse");
        bytes32 reverseNode = keccak256(abi.encodePacked(bytes32(0), reverseLabel));
        registry.setSubnodeOwner(0x0, reverseLabel, msg.sender); 
        bytes32 addrLabel = keccak256("addr");
        bytes32 addrReverseNode = keccak256(abi.encodePacked(reverseNode, addrLabel));
        ReverseRegistrar reverseRegistrar = new ReverseRegistrar(registry, addrReverseNode, address(resolver));
        registry.setSubnodeOwner(reverseNode, addrLabel, address(reverseRegistrar));

        // 8. Deploy Universal Resolver
        ArcUniversalResolver universalResolver = new ArcUniversalResolver(address(registry), addrReverseNode);

        // 9. Deploy Market
        ArcMarketU marketImpl = new ArcMarketU();
        data = abi.encodeWithSelector(ArcMarketU.initialize.selector, address(registrar));
        ERC1967Proxy marketProxy = new ERC1967Proxy(address(marketImpl), data);
        ArcMarketU market = ArcMarketU(address(marketProxy));
        market.setResolverConfig(address(registry), address(resolver), baseNode);

        vm.stopBroadcast();

        console.log("Arc Blockchain ENS Deployment Complete:");
        console.log("Registry:", address(registry));
        console.log("Registrar Proxy:", address(registrar));
        console.log("Resolver Proxy:", address(resolver));
        console.log("Controller Proxy:", address(controller));
        console.log("Reverse Registrar:", address(reverseRegistrar));
        console.log("Universal Resolver:", address(universalResolver));
        console.log("Market Proxy:", address(market));
    }
}
