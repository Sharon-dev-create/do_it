// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract DoItEscrow {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable verifier;

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

    event TaskCreated(
        uint256 indexed taskId,
        address indexed creator,
        uint256 reward
    );

    event TaskFunded(
        uint256 indexed taskId,
        address indexed creator,
        uint256 amount
    );

    event TaskClaimed(
        uint256 indexed taskId,
        address indexed worker
    );

    event RewardReleased(
        uint256 indexed taskId,
        address indexed worker,
        uint256 amount
    );

    event TaskRefunded(
        uint256 indexed taskId,
        address indexed creator,
        uint256 amount
    );

    error TaskNotFound();
    error NotCreator();
    error NotWorker();
    error NotVerifier();
    error InvalidReward();
    error InvalidStatus();
    error InvalidVerifier();

    constructor(
        address usdcAddress,
        address verifierAddress
    ) {
        if (verifierAddress == address(0)) {
            revert InvalidVerifier();
        }

        usdc = IERC20(usdcAddress);
        verifier = verifierAddress;
    }

    function createTask(uint256 reward)
        external
        returns (uint256 taskId)
    {
        if (reward == 0) {
            revert InvalidReward();
        }

        taskId = nextTaskId++;

        tasks[taskId] = Task({
            creator: msg.sender,
            worker: address(0),
            reward: reward,
            status: TaskStatus.Created
        });

        emit TaskCreated(
            taskId,
            msg.sender,
            reward
        );
    }

    function fundTask(uint256 taskId) external {
        Task storage task = tasks[taskId];

        if (task.creator == address(0)) {
            revert TaskNotFound();
        }

        if (msg.sender != task.creator) {
            revert NotCreator();
        }

        if (task.status != TaskStatus.Created) {
            revert InvalidStatus();
        }

        usdc.safeTransferFrom(
            task.creator,
            address(this),
            task.reward
        );

        task.status = TaskStatus.Funded;

        emit TaskFunded(
            taskId,
            task.creator,
            task.reward
        );
    }

    function claimTask(uint256 taskId) external {
        Task storage task = tasks[taskId];

        if (task.creator == address(0)) {
            revert TaskNotFound();
        }

        if (task.status != TaskStatus.Funded) {
            revert InvalidStatus();
        }

        task.worker = msg.sender;

        emit TaskClaimed(
            taskId,
            msg.sender
        );
    }

    function releaseReward(uint256 taskId) external {
        Task storage task = tasks[taskId];

        if (task.creator == address(0)) {
            revert TaskNotFound();
        }

        if (msg.sender != verifier) {
            revert NotVerifier();
        }

        if (task.status != TaskStatus.Funded) {
            revert InvalidStatus();
        }

        if (task.worker == address(0)) {
            revert NotWorker();
        }

        task.status = TaskStatus.Completed;

        usdc.safeTransfer(
            task.worker,
            task.reward
        );

        emit RewardReleased(
            taskId,
            task.worker,
            task.reward
        );
    }

    function refundTask(uint256 taskId) external {
        Task storage task = tasks[taskId];

        if (task.creator == address(0)) {
            revert TaskNotFound();
        }

        if (msg.sender != task.creator) {
            revert NotCreator();
        }

        if (task.status != TaskStatus.Funded) {
            revert InvalidStatus();
        }

        task.status = TaskStatus.Refunded;

        usdc.safeTransfer(
            task.creator,
            task.reward
        );

        emit TaskRefunded(
            taskId,
            task.creator,
            task.reward
        );
    }
}
