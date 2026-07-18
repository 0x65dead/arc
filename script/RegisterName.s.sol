// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/ArcController.sol";

contract RegisterName is Script {
    function run() external {
        // Load variables
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address payable controllerAddress = payable(vm.envAddress("CONTROLLER_ADDRESS"));
        string memory nameToRegister = vm.envString("NAME");
        uint256 duration = 365 days;
        bytes32 secret = keccak256("my_secret_salt");

        ArcControllerU controller = ArcControllerU(controllerAddress);
        address owner = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        /*
        // 1. Make Commitment (Already done, commented out)
        bytes32 commitment = controller.makeCommitment(nameToRegister, owner, secret);
        controller.commit(commitment);
        console.log("Committed:", nameToRegister);
        console.log("Wait at least 60 seconds (minCommitAge) before revealing...");
        */

        // 2. Reveal & Register (Run this after 60 seconds)
        uint256 cost = controller.price(nameToRegister, duration);
        console.log("Cost to register (native USDC wei):", cost);
        
        controller.register{value: cost}(
            nameToRegister, 
            owner, 
            duration, 
            secret
        );
        console.log("Successfully registered:", nameToRegister, ".arc");

        vm.stopBroadcast();
    }
}
