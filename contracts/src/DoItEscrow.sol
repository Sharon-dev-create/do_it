// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract DoItEscrow {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    uint256 public nextTaskId;

    enum TaskStatus {
        Created,
        Funded,
        Completed,
        Refunded
    }

    struct Task {
        address creator;
        address worker;
        uint256 reward;
        TaskStatus status;
    }

    mapping(uint256 => Task) public tasks;

    //Event emitted when a new task is created
    event TaskCreated(uint256 indexed taskId, address indexed creator, uint256 reward);

    //Event emitted when a task is funded
    event TaskFunded(uint256 indexed taskId, address indexed worker);

    //Event for reward released
    event RewardReleased(uint256 indexed taskId, address indexed creator, uint256 amount);

    //Event for refund released
    event RefundReleased(uint256 indexed taskId, address indexed creator, uint256 amount);

    error TaskNotFound();
    error NotCreator();
    error NotWorker();
    error InvalidWorker();
    error InvalidReward();
    error InvalidStatus();

    // @param _usdc The address of the USDC token contract
    constructor(address usdcAddress) {
        usdc = IERC20(usdcAddress);
    }

}
