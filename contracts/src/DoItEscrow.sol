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
    
    function createTask(address creator, uint256 reward) external returns (uint256 taskId) {
        if (reward == 0) {
            revert InvalidReward();
        }

        taskId = nextTaskId++;

        tasks[taskId] = Task({
            creator: creator,
            worker: address(0),
            reward: reward,
            status: TaskStatus.Created
        });

        emit TaskCreated(taskId, creator, reward);
    }

    function fundTask(uint256 taskId, address worker) external {
        Task storage task = tasks[taskId];

        if (task.status != TaskStatus.Created) {
            revert InvalidStatus();
        }

        if (worker == address(0)) {
            revert InvalidWorker();
        }

        if (msg.sender != task.creator) {
            revert NotCreator();
        }

        task.worker = worker;
        task.status = TaskStatus.Funded;

        emit TaskFunded(taskId, worker);
    }

    function releaseReward(uint256 taskId) external {
        Task storage task = tasks[taskId];

        if (task.status != TaskStatus.Funded) {
            revert InvalidStatus();
        }

        if (msg.sender != task.worker) {
            revert NotWorker();
        }

        task.status = TaskStatus.Completed;

        usdc.safeTransfer(task.worker, task.reward);

        emit RewardReleased(taskId, task.creator, task.reward);
    }
}
