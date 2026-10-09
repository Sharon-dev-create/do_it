// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DoItEscrowV2} from "../src/DoItEscrowV2.sol";
import {Script} from "forge-std/Script.sol";

contract DeployDoItEscrowV2 is Script {
    uint256 constant ARC_TESTNET_CHAIN_ID = 5042002;

    address constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    address constant VERIFIER = 0x41aa5227695B8c6c5FfAD3bF3A9aAF0626921d0E;

    function run() external returns (DoItEscrowV2 escrow) {
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "Wrong chain");

        vm.startBroadcast();
        escrow = new DoItEscrowV2(ARC_TESTNET_USDC, VERIFIER);
        vm.stopBroadcast();
    }
}
