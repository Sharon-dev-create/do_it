// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DoItEscrowV2} from "../src/DoItEscrowV2.sol";

contract MockUSDCV2 is IERC20 {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    bool public failTransfers;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes public callbackResult;

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function setDecimals(uint8 value) external {
        decimals = value;
    }

    function setFailTransfers(bool value) external {
        failTransfers = value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        if (callbackTarget != address(0)) {
            (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
        }
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        if (callbackTarget != address(0)) {
            (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
        }
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
}

contract ReentrantWorker {
    DoItEscrowV2 public immutable escrow;
    bool public reentryBlocked;

    constructor(DoItEscrowV2 escrow_) {
        escrow = escrow_;
    }

    function withdraw(uint256 amount) external {
        escrow.withdraw(amount);
    }

    function onTokenTransfer() external {
        try escrow.withdraw(1) {
            reentryBlocked = false;
        } catch {
            reentryBlocked = true;
        }
    }
}

contract ReentrantCreator {
    DoItEscrowV2 public immutable escrow;
    bool public reentryBlocked;

    constructor(DoItEscrowV2 escrow_) {
        escrow = escrow_;
    }

    function approveUSDC(MockUSDCV2 token) external {
        token.approve(address(escrow), type(uint256).max);
    }

    function createAndFund(uint256 reward) external returns (uint256 taskId) {
        taskId = escrow.createTask(reward);
        escrow.fundTask(taskId);
    }

    function refund(uint256 taskId) external {
        escrow.refundTask(taskId);
    }

    function onTokenTransfer(uint256 taskId) external {
        try escrow.refundTask(taskId) {
            reentryBlocked = false;
        } catch {
            reentryBlocked = true;
        }
    }

    function onFundingTransfer(uint256 taskId) external {
        try escrow.fundTask(taskId) {
            reentryBlocked = false;
        } catch {
            reentryBlocked = true;
        }
    }

    function createTask(uint256 reward) external returns (uint256 taskId) {
        taskId = escrow.createTask(reward);
    }

    function fundTask(uint256 taskId) external {
        escrow.fundTask(taskId);
    }
}

contract DoItEscrowV2Test is Test {
    uint256 internal constant ONE_USDC = 1_000_000;
    uint256 internal constant TWO_USDC = 2_000_000;

    MockUSDCV2 internal usdc;
    DoItEscrowV2 internal escrow;
    address internal creator = address(0x101);
    address internal worker = address(0x202);
    address internal worker2 = address(0x303);
    address internal attacker = address(0x404);
    address internal verifier = address(0x505);

    function setUp() public {
        usdc = new MockUSDCV2();
        escrow = new DoItEscrowV2(address(usdc), verifier);
        usdc.mint(creator, 100 * ONE_USDC);
        vm.prank(creator);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function testCreateTaskAndRejectZeroReward() public {
        vm.prank(creator);
        uint256 id = escrow.createTask(ONE_USDC);
        (address taskCreator, address taskWorker, uint256 reward, DoItEscrowV2.TaskStatus status) = escrow.tasks(id);
        assertEq(taskCreator, creator);
        assertEq(taskWorker, address(0));
        assertEq(reward, ONE_USDC);
        assertEq(uint256(status), uint256(DoItEscrowV2.TaskStatus.Created));
        assertEq(escrow.nextTaskId(), 1);

        vm.prank(creator);
        vm.expectRevert(DoItEscrowV2.InvalidReward.selector);
        escrow.createTask(0);
    }

    function testConstructorRejectsZeroUSDCOrVerifier() public {
        vm.expectRevert(DoItEscrowV2.InvalidUSDC.selector);
        new DoItEscrowV2(address(0), verifier);
        vm.expectRevert(DoItEscrowV2.InvalidVerifier.selector);
        new DoItEscrowV2(address(usdc), address(0));
    }

    function testConstructorRejectsTokenWithoutSixDecimals() public {
        usdc.setDecimals(18);
        vm.expectRevert(abi.encodeWithSelector(DoItEscrowV2.InvalidUSDCDecimals.selector, uint8(18)));
        new DoItEscrowV2(address(usdc), verifier);
    }

    function testFundTaskUsesAllowanceAndAddsLiabilityInSixDecimalUnits() public {
        uint256 id = _createFunded(ONE_USDC);
        assertEq(usdc.balanceOf(address(escrow)), ONE_USDC);
        assertEq(usdc.balanceOf(creator), 99 * ONE_USDC);
        assertEq(escrow.outstandingTaskLiabilities(), ONE_USDC);
        assertEq(escrow.totalWithdrawableEarnings(), 0);
        assertTrue(escrow.isSolvent());
        (,, uint256 reward, DoItEscrowV2.TaskStatus status) = escrow.tasks(id);
        assertEq(reward, 1_000_000); // exactly 1 USDC in six-decimal base units
        assertEq(uint256(status), uint256(DoItEscrowV2.TaskStatus.Funded));
    }

    function testFundingRequiresCreatorAndAllowance() public {
        vm.prank(creator);
        uint256 id = escrow.createTask(ONE_USDC);
        vm.prank(attacker);
        vm.expectRevert(DoItEscrowV2.NotCreator.selector);
        escrow.fundTask(id);

        vm.prank(creator);
        usdc.approve(address(escrow), 0);
        vm.prank(creator);
        vm.expectRevert();
        escrow.fundTask(id);
        assertEq(escrow.outstandingTaskLiabilities(), 0);
    }

    function testFundingTransferRevertLeavesTaskAndLiabilityUnchanged() public {
        vm.prank(creator);
        uint256 id = escrow.createTask(ONE_USDC);
        usdc.setFailTransfers(true);

        vm.prank(creator);
        vm.expectRevert();
        escrow.fundTask(id);

        (,,, DoItEscrowV2.TaskStatus status) = escrow.tasks(id);
        assertEq(uint256(status), uint256(DoItEscrowV2.TaskStatus.Created));
        assertEq(escrow.outstandingTaskLiabilities(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertTrue(escrow.isSolvent());
    }

    function testCannotFundTwiceOrReleaseBeforeClaim() public {
        uint256 id = _createFunded(ONE_USDC);

        vm.prank(creator);
        vm.expectRevert(DoItEscrowV2.InvalidStatus.selector);
        escrow.fundTask(id);

        vm.prank(verifier);
        vm.expectRevert(DoItEscrowV2.InvalidStatus.selector);
        escrow.releaseReward(id);
        assertEq(escrow.outstandingTaskLiabilities(), ONE_USDC);
        assertEq(escrow.totalWithdrawableEarnings(), 0);
        assertTrue(escrow.isSolvent());
    }

    function testClaimTaskAndRejectInvalidClaim() public {
        uint256 id = _createFunded(ONE_USDC);
        vm.prank(worker);
        escrow.claimTask(id);
        (, address taskWorker,, DoItEscrowV2.TaskStatus status) = escrow.tasks(id);
        assertEq(taskWorker, worker);
        assertEq(uint256(status), uint256(DoItEscrowV2.TaskStatus.Claimed));
        assertEq(escrow.outstandingTaskLiabilities(), ONE_USDC);

        vm.prank(worker2);
        vm.expectRevert(DoItEscrowV2.InvalidStatus.selector);
        escrow.claimTask(id);
    }

    function testUnknownTaskIsRejected() public {
        vm.expectRevert(DoItEscrowV2.TaskNotFound.selector);
        escrow.claimTask(999);
        vm.prank(verifier);
        vm.expectRevert(DoItEscrowV2.TaskNotFound.selector);
        escrow.releaseReward(999);
    }

    function testOnlyVerifierCanCreditRewardAndCreditDoesNotTransferUSDC() public {
        uint256 id = _createClaimed(worker, TWO_USDC);
        uint256 escrowBalanceBefore = usdc.balanceOf(address(escrow));
        uint256 workerBalanceBefore = usdc.balanceOf(worker);

        vm.prank(attacker);
        vm.expectRevert(DoItEscrowV2.NotVerifier.selector);
        escrow.releaseReward(id);

        vm.prank(verifier);
        escrow.releaseReward(id);

        assertEq(usdc.balanceOf(address(escrow)), escrowBalanceBefore);
        assertEq(usdc.balanceOf(worker), workerBalanceBefore);
        assertEq(escrow.availableBalance(worker), TWO_USDC);
        assertEq(escrow.outstandingTaskLiabilities(), 0);
        assertEq(escrow.totalWithdrawableEarnings(), TWO_USDC);
        (,,, DoItEscrowV2.TaskStatus status) = escrow.tasks(id);
        assertEq(uint256(status), uint256(DoItEscrowV2.TaskStatus.Completed));
        assertTrue(escrow.isSolvent());
    }

    function testRewardCannotBeCreditedTwice() public {
        uint256 id = _createClaimed(worker, ONE_USDC);
        vm.startPrank(verifier);
        escrow.releaseReward(id);
        vm.expectRevert(DoItEscrowV2.InvalidStatus.selector);
        escrow.releaseReward(id);
        vm.stopPrank();
        assertEq(escrow.availableBalance(worker), ONE_USDC);
        assertEq(escrow.totalWithdrawableEarnings(), ONE_USDC);
    }

    function testWithdrawalOfPartAndEntireBalance() public {
        _credit(worker, TWO_USDC);
        vm.prank(worker);
        escrow.withdraw(ONE_USDC);
        assertEq(usdc.balanceOf(worker), ONE_USDC);
        assertEq(escrow.availableBalance(worker), ONE_USDC);
        assertEq(escrow.totalWithdrawableEarnings(), ONE_USDC);
        assertTrue(escrow.isSolvent());

        vm.prank(worker);
        escrow.withdraw(ONE_USDC);
        assertEq(usdc.balanceOf(worker), TWO_USDC);
        assertEq(escrow.availableBalance(worker), 0);
        assertEq(escrow.totalWithdrawableEarnings(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertTrue(escrow.isSolvent());
    }

    function testWithdrawRejectsZeroAndAmountAboveBalance() public {
        _credit(worker, ONE_USDC);
        vm.prank(worker);
        vm.expectRevert(DoItEscrowV2.InvalidAmount.selector);
        escrow.withdraw(0);
        vm.prank(worker);
        vm.expectRevert(DoItEscrowV2.InsufficientEarnings.selector);
        escrow.withdraw(ONE_USDC + 1);
        assertEq(escrow.availableBalance(worker), ONE_USDC);
    }

    function testWithdrawalTransferRevertRollsBackEarningsAccounting() public {
        _credit(worker, ONE_USDC);
        usdc.setFailTransfers(true);

        vm.prank(worker);
        vm.expectRevert();
        escrow.withdraw(ONE_USDC);

        assertEq(escrow.availableBalance(worker), ONE_USDC);
        assertEq(escrow.totalWithdrawableEarnings(), ONE_USDC);
        assertEq(usdc.balanceOf(address(escrow)), ONE_USDC);
        assertTrue(escrow.isSolvent());
    }

    function testCallerCannotWithdrawAnotherWorkersEarnings() public {
        _credit(worker, ONE_USDC);
        vm.prank(attacker);
        vm.expectRevert(DoItEscrowV2.InsufficientEarnings.selector);
        escrow.withdraw(1);
        assertEq(escrow.availableBalance(worker), ONE_USDC);
        assertEq(escrow.availableBalance(attacker), 0);
    }

    function testRefundFundedTaskAndRemoveLiability() public {
        uint256 id = _createFunded(TWO_USDC);
        vm.prank(creator);
        escrow.refundTask(id);
        assertEq(usdc.balanceOf(creator), 100 * ONE_USDC);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.outstandingTaskLiabilities(), 0);
        (,,, DoItEscrowV2.TaskStatus status) = escrow.tasks(id);
        assertEq(uint256(status), uint256(DoItEscrowV2.TaskStatus.Refunded));
        assertTrue(escrow.isSolvent());
    }

    function testRefundRejectsUnauthorizedCallerAndClaimedTask() public {
        uint256 fundedId = _createFunded(ONE_USDC);
        vm.prank(attacker);
        vm.expectRevert(DoItEscrowV2.NotCreator.selector);
        escrow.refundTask(fundedId);

        uint256 claimedId = _createClaimed(worker, ONE_USDC);
        vm.prank(creator);
        vm.expectRevert(DoItEscrowV2.InvalidStatus.selector);
        escrow.refundTask(claimedId);
        assertEq(escrow.outstandingTaskLiabilities(), 2 * ONE_USDC);
    }

    function testRefundRejectedAfterRewardCredit() public {
        uint256 id = _createClaimed(worker, ONE_USDC);
        vm.prank(verifier);
        escrow.releaseReward(id);
        vm.prank(creator);
        vm.expectRevert(DoItEscrowV2.InvalidStatus.selector);
        escrow.refundTask(id);
        assertEq(escrow.availableBalance(worker), ONE_USDC);
    }

    function testRefundRejectedBeforeFundingAndForUnknownTask() public {
        vm.prank(creator);
        uint256 id = escrow.createTask(ONE_USDC);
        vm.prank(creator);
        vm.expectRevert(DoItEscrowV2.InvalidStatus.selector);
        escrow.refundTask(id);
        vm.prank(creator);
        vm.expectRevert(DoItEscrowV2.TaskNotFound.selector);
        escrow.refundTask(999);
    }

    function testRefundTransferRevertRollsBackTaskAccounting() public {
        uint256 id = _createFunded(ONE_USDC);
        usdc.setFailTransfers(true);

        vm.prank(creator);
        vm.expectRevert();
        escrow.refundTask(id);

        (,,, DoItEscrowV2.TaskStatus status) = escrow.tasks(id);
        assertEq(uint256(status), uint256(DoItEscrowV2.TaskStatus.Funded));
        assertEq(escrow.outstandingTaskLiabilities(), ONE_USDC);
        assertEq(usdc.balanceOf(address(escrow)), ONE_USDC);
        assertTrue(escrow.isSolvent());
    }

    function testMultipleTasksAccumulateForWorker() public {
        uint256 first = _createClaimed(worker, ONE_USDC);
        uint256 second = _createClaimed(worker, TWO_USDC);
        vm.startPrank(verifier);
        escrow.releaseReward(first);
        escrow.releaseReward(second);
        vm.stopPrank();
        assertEq(escrow.availableBalance(worker), 3 * ONE_USDC);
        assertEq(escrow.totalWithdrawableEarnings(), 3 * ONE_USDC);
        assertEq(escrow.outstandingTaskLiabilities(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 3 * ONE_USDC);
        assertTrue(escrow.isSolvent());
    }

    function testWorkerWithdrawalDoesNotAffectAnotherWorkersBalance() public {
        _credit(worker, TWO_USDC);
        _credit(worker2, ONE_USDC);
        vm.prank(worker);
        escrow.withdraw(ONE_USDC);
        assertEq(escrow.availableBalance(worker), ONE_USDC);
        assertEq(escrow.availableBalance(worker2), ONE_USDC);
        assertEq(escrow.totalWithdrawableEarnings(), 2 * ONE_USDC);
        assertTrue(escrow.isSolvent());
    }

    function testReentrantWithdrawalIsBlocked() public {
        ReentrantWorker reentrantWorker = new ReentrantWorker(escrow);
        _credit(address(reentrantWorker), ONE_USDC);
        usdc.setCallback(address(reentrantWorker), abi.encodeCall(ReentrantWorker.onTokenTransfer, ()));

        reentrantWorker.withdraw(ONE_USDC);
        assertTrue(reentrantWorker.reentryBlocked());
        assertEq(escrow.availableBalance(address(reentrantWorker)), 0);
        assertEq(usdc.balanceOf(address(reentrantWorker)), ONE_USDC);
        assertEq(escrow.totalWithdrawableEarnings(), 0);
        assertTrue(escrow.isSolvent());
    }

    function testReentrantRefundIsBlocked() public {
        ReentrantCreator reentrantCreator = new ReentrantCreator(escrow);
        usdc.mint(address(reentrantCreator), ONE_USDC);
        reentrantCreator.approveUSDC(usdc);
        uint256 id = reentrantCreator.createAndFund(ONE_USDC);
        usdc.setCallback(address(reentrantCreator), abi.encodeCall(ReentrantCreator.onTokenTransfer, (id)));

        reentrantCreator.refund(id);
        assertTrue(reentrantCreator.reentryBlocked());
        assertEq(escrow.outstandingTaskLiabilities(), 0);
        assertEq(usdc.balanceOf(address(reentrantCreator)), ONE_USDC);
        assertTrue(escrow.isSolvent());
    }

    function testReentrantFundingIsBlocked() public {
        ReentrantCreator reentrantCreator = new ReentrantCreator(escrow);
        usdc.mint(address(reentrantCreator), ONE_USDC);
        reentrantCreator.approveUSDC(usdc);
        uint256 id = reentrantCreator.createTask(ONE_USDC);
        usdc.setCallback(address(reentrantCreator), abi.encodeCall(ReentrantCreator.onFundingTransfer, (id)));

        reentrantCreator.fundTask(id);
        assertTrue(reentrantCreator.reentryBlocked());
        assertEq(escrow.outstandingTaskLiabilities(), ONE_USDC);
        assertEq(usdc.balanceOf(address(escrow)), ONE_USDC);
        assertTrue(escrow.isSolvent());
    }

    function testLiabilityAndSolvencyAcrossFundCreditRefundAndWithdrawal() public {
        uint256 fundedId = _createFunded(ONE_USDC);
        uint256 claimedId = _createClaimed(worker, TWO_USDC);
        assertEq(escrow.outstandingTaskLiabilities(), 3 * ONE_USDC);
        assertEq(escrow.totalWithdrawableEarnings(), 0);
        assertTrue(escrow.isSolvent());

        vm.prank(creator);
        escrow.refundTask(fundedId);
        assertEq(escrow.outstandingTaskLiabilities(), TWO_USDC);
        assertTrue(escrow.isSolvent());

        vm.prank(verifier);
        escrow.releaseReward(claimedId);
        assertEq(escrow.outstandingTaskLiabilities(), 0);
        assertEq(escrow.totalWithdrawableEarnings(), TWO_USDC);
        assertTrue(escrow.isSolvent());

        vm.prank(worker);
        escrow.withdraw(ONE_USDC);
        assertEq(escrow.totalWithdrawableEarnings(), ONE_USDC);
        assertEq(usdc.balanceOf(address(escrow)), ONE_USDC);
        assertTrue(escrow.isSolvent());
    }

    function testClaimedTaskCannotBeRefundedAndClaimDoesNotChangeLiability() public {
        uint256 id = _createFunded(ONE_USDC);
        vm.prank(worker);
        escrow.claimTask(id);
        assertEq(escrow.outstandingTaskLiabilities(), ONE_USDC);
        vm.prank(creator);
        vm.expectRevert(DoItEscrowV2.InvalidStatus.selector);
        escrow.refundTask(id);
        assertTrue(escrow.isSolvent());
    }

    function _createFunded(uint256 reward) internal returns (uint256 id) {
        vm.startPrank(creator);
        id = escrow.createTask(reward);
        escrow.fundTask(id);
        vm.stopPrank();
    }

    function _createClaimed(address taskWorker, uint256 reward) internal returns (uint256 id) {
        id = _createFunded(reward);
        vm.prank(taskWorker);
        escrow.claimTask(id);
    }

    function _credit(address taskWorker, uint256 reward) internal returns (uint256 id) {
        id = _createClaimed(taskWorker, reward);
        vm.prank(verifier);
        escrow.releaseReward(id);
    }
}
