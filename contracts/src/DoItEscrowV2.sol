// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Task escrow whose verified rewards accrue to workers for later withdrawal.
/// @dev All amounts are raw USDC base units (six decimals on Arc Testnet).
contract DoItEscrowV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable verifier;
    uint256 public nextTaskId;

    /// @notice Liabilities for tasks in Funded or Claimed state.
    uint256 public outstandingTaskLiabilities;
    /// @notice Sum of all workers' available earnings.
    uint256 public totalWithdrawableEarnings;

    enum TaskStatus {
        Created,
        Funded,
        Claimed,
        Completed,
        Refunded
    }

    struct Task {
        address creator;
        address worker;
        uint256 reward;
        TaskStatus status;
    }

    mapping(uint256 taskId => Task) public tasks;
    mapping(address worker => uint256 amount) public availableBalance;

    event TaskCreated(uint256 indexed taskId, address indexed creator, uint256 reward);
    event TaskFunded(uint256 indexed taskId, address indexed creator, uint256 amount);
    event TaskClaimed(uint256 indexed taskId, address indexed worker);
    event RewardCredited(uint256 indexed taskId, address indexed worker, uint256 amount);
    event EarningsWithdrawn(address indexed worker, uint256 amount);
    event TaskRefunded(uint256 indexed taskId, address indexed creator, uint256 amount);

    error InvalidUSDC();
    error InvalidUSDCDecimals(uint8 actualDecimals);
    error InvalidVerifier();
    error TaskNotFound();
    error NotCreator();
    error NotVerifier();
    error InvalidReward();
    error InvalidStatus();
    error InvalidAmount();
    error InsufficientEarnings();
    error InexactTokenTransfer();
    error Insolvent();

    constructor(address usdcAddress, address verifierAddress) {
        if (usdcAddress == address(0)) revert InvalidUSDC();
        if (verifierAddress == address(0)) revert InvalidVerifier();

        uint8 tokenDecimals = IERC20Metadata(usdcAddress).decimals();
        if (tokenDecimals != 6) revert InvalidUSDCDecimals(tokenDecimals);

        usdc = IERC20(usdcAddress);
        verifier = verifierAddress;
    }

    function createTask(uint256 reward) external returns (uint256 taskId) {
        if (reward == 0) revert InvalidReward();

        taskId = nextTaskId++;
        tasks[taskId] = Task({creator: msg.sender, worker: address(0), reward: reward, status: TaskStatus.Created});
        emit TaskCreated(taskId, msg.sender, reward);
    }

    function fundTask(uint256 taskId) external nonReentrant {
        Task storage task = _task(taskId);
        if (msg.sender != task.creator) revert NotCreator();
        if (task.status != TaskStatus.Created) revert InvalidStatus();

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(task.creator, address(this), task.reward);
        if (usdc.balanceOf(address(this)) - balanceBefore != task.reward) revert InexactTokenTransfer();

        task.status = TaskStatus.Funded;
        outstandingTaskLiabilities += task.reward;
        _requireSolvent();
        emit TaskFunded(taskId, task.creator, task.reward);
    }

    function claimTask(uint256 taskId) external {
        Task storage task = _task(taskId);
        if (task.status != TaskStatus.Funded) revert InvalidStatus();

        task.worker = msg.sender;
        task.status = TaskStatus.Claimed;
        emit TaskClaimed(taskId, msg.sender);
    }

    /// @notice Completes a claimed task and credits earnings without transferring USDC.
    function releaseReward(uint256 taskId) external {
        Task storage task = _task(taskId);
        if (msg.sender != verifier) revert NotVerifier();
        if (task.status != TaskStatus.Claimed) revert InvalidStatus();

        task.status = TaskStatus.Completed;
        outstandingTaskLiabilities -= task.reward;
        availableBalance[task.worker] += task.reward;
        totalWithdrawableEarnings += task.reward;
        _requireSolvent();
        emit RewardCredited(taskId, task.worker, task.reward);
    }

    /// @notice Withdraws only the caller's own accumulated earnings.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (availableBalance[msg.sender] < amount) revert InsufficientEarnings();

        // Effects precede the token call; a failed or inexact transfer reverts these effects.
        availableBalance[msg.sender] -= amount;
        totalWithdrawableEarnings -= amount;
        _transferExact(msg.sender, amount);
        _requireSolvent();
        emit EarningsWithdrawn(msg.sender, amount);
    }

    /// @notice Refunds a funded, unclaimed task to its creator.
    function refundTask(uint256 taskId) external nonReentrant {
        Task storage task = _task(taskId);
        if (msg.sender != task.creator) revert NotCreator();
        if (task.status != TaskStatus.Funded) revert InvalidStatus();

        task.status = TaskStatus.Refunded;
        outstandingTaskLiabilities -= task.reward;
        _transferExact(task.creator, task.reward);
        _requireSolvent();
        emit TaskRefunded(taskId, task.creator, task.reward);
    }

    /// @notice True when token holdings cover all task and worker liabilities.
    function isSolvent() external view returns (bool) {
        return usdc.balanceOf(address(this)) >= outstandingTaskLiabilities + totalWithdrawableEarnings;
    }

    function _task(uint256 taskId) private view returns (Task storage task) {
        task = tasks[taskId];
        if (task.creator == address(0)) revert TaskNotFound();
    }

    function _transferExact(address recipient, uint256 amount) private {
        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransfer(recipient, amount);
        if (balanceBefore - usdc.balanceOf(address(this)) != amount) revert InexactTokenTransfer();
    }

    function _requireSolvent() private view {
        if (usdc.balanceOf(address(this)) < outstandingTaskLiabilities + totalWithdrawableEarnings) {
            revert Insolvent();
        }
    }
}
