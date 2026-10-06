//SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DoItEscrow} from "../src/DoItEscrow.sol";
import {Script} from "forge-std/Script.sol";

contract DeployDoItEscrow is Script {
    address constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (DoItEscrow escrow) {
        vm.startBroadcast();
        escrow = new DoItEscrow(ARC_TESTNET_USDC, msg.sender);
        vm.stopBroadcast();
    }
}
