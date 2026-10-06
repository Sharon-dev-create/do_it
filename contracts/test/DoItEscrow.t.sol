// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DoItEscrow} from "../src/DoItEscrow.sol";

contract MockUSDC is IERC20 {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(
        address to,
        uint256 amount
    ) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;

        emit Transfer(msg.sender, to, amount);

        return true;
    }

    function approve(
        address spender,
        uint256 amount
    ) external returns (bool) {
        allowance[msg.sender][spender] = amount;

        emit Approval(msg.sender, spender, amount);

        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];

        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }

        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);

        return true;
    }

    function mint(
        address to,
        uint256 amount
    ) external {
        balanceOf[to] += amount;
        totalSupply += amount;

        emit Transfer(address(0), to, amount);
    }
}

contract DoItEscrowTest is Test {
    MockUSDC usdc;
    DoItEscrow escrow;

    address buyer = address(0x1);
    address worker = address(0x2);
    address attacker = address(0x3);
    address verifier = address(0x4);

    uint256 reward = 1_000_000; // 1 USDC

    function setUp() public {
        usdc = new MockUSDC();

        escrow = new DoItEscrow(
            address(usdc),
            verifier
        );

        usdc.mint(buyer, reward);

        vm.prank(buyer);
        usdc.approve(
            address(escrow),
            reward
        );
    }

    function testCreateTask() public {
        vm.prank(buyer);

        uint256 taskId = escrow.createTask(reward);

        (
            address taskCreator,
            address taskWorker,
            uint256 taskReward,
            DoItEscrow.TaskStatus status
        ) = escrow.tasks(taskId);

        assertEq(taskCreator, buyer);
        assertEq(taskWorker, address(0));
        assertEq(taskReward, reward);

        assertEq(
            uint256(status),
            uint256(DoItEscrow.TaskStatus.Created)
        );
    }

    function testFundTask() public {
        vm.startPrank(buyer);

        uint256 taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);

        vm.stopPrank();

        assertEq(
            usdc.balanceOf(address(escrow)),
            reward
        );

        (
            ,
            address taskWorker,
            ,
            DoItEscrow.TaskStatus status
        ) = escrow.tasks(taskId);

        assertEq(taskWorker, address(0));

        assertEq(
            uint256(status),
            uint256(DoItEscrow.TaskStatus.Funded)
        );
    }

    function testOnlyBuyerCanFund() public {
        vm.prank(buyer);

        uint256 taskId = escrow.createTask(reward);

        vm.prank(attacker);

        vm.expectRevert(
            DoItEscrow.NotCreator.selector
        );

        escrow.fundTask(taskId);
    }

    function testWorkerCanClaimTask() public {
        vm.startPrank(buyer);

        uint256 taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);

        vm.stopPrank();

        vm.prank(worker);
        escrow.claimTask(taskId);

        (
            ,
            address taskWorker,
            ,
            DoItEscrow.TaskStatus status
        ) = escrow.tasks(taskId);

        assertEq(taskWorker, worker);

        assertEq(
            uint256(status),
            uint256(DoItEscrow.TaskStatus.Claimed)
        );
    }

    function testOnlyFundedTaskCanBeClaimed() public {
        vm.prank(buyer);

        uint256 taskId = escrow.createTask(reward);

        vm.prank(worker);

        vm.expectRevert(
            DoItEscrow.InvalidStatus.selector
        );

        escrow.claimTask(taskId);
    }

    function testReleaseReward() public {
        vm.startPrank(buyer);

        uint256 taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);

        vm.stopPrank();

        vm.prank(worker);
        escrow.claimTask(taskId);

        vm.prank(verifier);
        escrow.releaseReward(taskId);

        assertEq(
            usdc.balanceOf(worker),
            reward
        );

        assertEq(
            usdc.balanceOf(address(escrow)),
            0
        );

        (
            ,
            address taskWorker,
            ,
            DoItEscrow.TaskStatus status
        ) = escrow.tasks(taskId);

        assertEq(taskWorker, worker);

        assertEq(
            uint256(status),
            uint256(DoItEscrow.TaskStatus.Completed)
        );
    }

    function testOnlyVerifierCanReleaseReward() public {
        vm.startPrank(buyer);

        uint256 taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);

        vm.stopPrank();

        vm.prank(worker);
        escrow.claimTask(taskId);

        vm.prank(attacker);

        vm.expectRevert(
            DoItEscrow.NotVerifier.selector
        );

        escrow.releaseReward(taskId);
    }

    function testWorkerCannotReleaseOwnReward() public {
        vm.startPrank(buyer);

        uint256 taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);

        vm.stopPrank();

        vm.prank(worker);
        escrow.claimTask(taskId);

        vm.prank(worker);

        vm.expectRevert(
            DoItEscrow.NotVerifier.selector
        );

        escrow.releaseReward(taskId);
    }

    function testCannotReleaseBeforeClaim() public {
        vm.startPrank(buyer);

        uint256 taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);

        vm.stopPrank();

        vm.prank(verifier);

        vm.expectRevert(
            DoItEscrow.InvalidStatus.selector
        );

        escrow.releaseReward(taskId);
    }

    function testCannotReleaseBeforeFunding() public {
        vm.prank(buyer);

        uint256 taskId = escrow.createTask(reward);

        vm.prank(verifier);

        vm.expectRevert(
            DoItEscrow.InvalidStatus.selector
        );

        escrow.releaseReward(taskId);
    }

    function testRefundTask() public {
        vm.startPrank(buyer);

        uint256 taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);
        escrow.refundTask(taskId);

        vm.stopPrank();

        assertEq(
            usdc.balanceOf(buyer),
            reward
        );

        assertEq(
            usdc.balanceOf(address(escrow)),
            0
        );

        (
            ,
            ,
            ,
            DoItEscrow.TaskStatus status
        ) = escrow.tasks(taskId);

        assertEq(
            uint256(status),
            uint256(DoItEscrow.TaskStatus.Refunded)
        );
    }

    function testCannotRefundBeforeFunding() public {
        vm.prank(buyer);

        uint256 taskId = escrow.createTask(reward);

        vm.prank(buyer);

        vm.expectRevert(
            DoItEscrow.InvalidStatus.selector
        );

        escrow.refundTask(taskId);
    }

    function testOnlyBuyerCanRefund() public {
        vm.startPrank(buyer);

        uint256 taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);

        vm.stopPrank();

        vm.prank(attacker);

        vm.expectRevert(
            DoItEscrow.NotCreator.selector
        );

        escrow.refundTask(taskId);
    }

    function testCannotReleaseTwice() public {
        vm.startPrank(buyer);

        uint256 taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);

        vm.stopPrank();

        vm.prank(worker);
        escrow.claimTask(taskId);

        vm.prank(verifier);
        escrow.releaseReward(taskId);

        vm.prank(verifier);

        vm.expectRevert(
            DoItEscrow.InvalidStatus.selector
        );

        escrow.releaseReward(taskId);
    }

    function testCannotRefundAfterCompletion() public {
        vm.startPrank(buyer);

        uint256 taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);

        vm.stopPrank();

        vm.prank(worker);
        escrow.claimTask(taskId);

        vm.prank(verifier);
        escrow.releaseReward(taskId);

        vm.prank(buyer);

        vm.expectRevert(
            DoItEscrow.InvalidStatus.selector
        );

        escrow.refundTask(taskId);
    }

    function testCannotClaimTwice() public {
    vm.startPrank(buyer);

    uint256 taskId = escrow.createTask(reward);
    escrow.fundTask(taskId);

    vm.stopPrank();

    vm.prank(worker);
    escrow.claimTask(taskId);

    vm.prank(attacker);

    vm.expectRevert(
        DoItEscrow.InvalidStatus.selector
    );

    escrow.claimTask(taskId);
}

function testCannotRefundAfterClaim() public {
    vm.startPrank(buyer);

    uint256 taskId = escrow.createTask(reward);
    escrow.fundTask(taskId);

    vm.stopPrank();

    vm.prank(worker);
    escrow.claimTask(taskId);

    vm.prank(buyer);

    vm.expectRevert(
        DoItEscrow.InvalidStatus.selector
    );

    escrow.refundTask(taskId);
}
}