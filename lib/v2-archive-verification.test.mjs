import assert from "node:assert/strict";
import test from "node:test";
import { ARC_ESCROW, TEST_CREATOR, TEST_WORKER, taskCreatedFixture, taskFundedFixture, rewardCreditedFixture } from "./fixtures-v2-archive-receipts.mjs";
import { DO_IT_ESCROW_ABI } from "./contracts/doItEscrow.ts";
import { verifyEscrowRefundReceipt, verifyEscrowRewardReceipt, verifyEscrowTaskReceipt } from "./v2-archive-receipt-verification.ts";
import { scanRefundLogRanges, V2_REFUND_SCAN_BLOCK_WINDOW } from "./v2-refund-log-scan.ts";

const ID0 = 0n;
const ID3 = 3n;
const AMOUNT0 = 10000n;
const AMOUNT3 = 100000n;

test("captured sanitized create, fund, and reward receipts verify against the deployed escrow ABI", () => {
  assert.equal(verifyEscrowTaskReceipt(taskCreatedFixture, taskCreatedFixture.transactionHash, "TaskCreated", ID0, TEST_CREATOR, AMOUNT0, DO_IT_ESCROW_ABI, ARC_ESCROW), true);
  assert.equal(verifyEscrowTaskReceipt(taskFundedFixture, taskFundedFixture.transactionHash, "TaskFunded", ID0, TEST_CREATOR, AMOUNT0, DO_IT_ESCROW_ABI, ARC_ESCROW), true);
  assert.equal(verifyEscrowRewardReceipt(rewardCreditedFixture, rewardCreditedFixture.transactionHash, ID3, TEST_WORKER, AMOUNT3, DO_IT_ESCROW_ABI, ARC_ESCROW), true);
});

test("receipt verification rejects failure, wrong contract, unrelated tx, wrong task, wrong amount, missing and malformed events", () => {
  const cases = [
    [{ ...taskCreatedFixture, status: "reverted" }, taskCreatedFixture.transactionHash, ID0, TEST_CREATOR, AMOUNT0],
    [{ ...taskCreatedFixture, blockNumber: 1n }, taskCreatedFixture.transactionHash, ID0, TEST_CREATOR, AMOUNT0],
    [{ ...taskCreatedFixture, to: "0x3333333333333333333333333333333333333333" }, taskCreatedFixture.transactionHash, ID0, TEST_CREATOR, AMOUNT0],
    [{ ...taskCreatedFixture, logs: [{ ...taskCreatedFixture.logs[0], address: "0x3333333333333333333333333333333333333333" }] }, taskCreatedFixture.transactionHash, ID0, TEST_CREATOR, AMOUNT0],
    [taskCreatedFixture, `0x${"d".repeat(64)}`, ID0, TEST_CREATOR, AMOUNT0],
    [taskCreatedFixture, taskCreatedFixture.transactionHash, 9n, TEST_CREATOR, AMOUNT0],
    [taskCreatedFixture, taskCreatedFixture.transactionHash, ID0, TEST_CREATOR, AMOUNT0 + 1n],
    [{ ...taskCreatedFixture, logs: [] }, taskCreatedFixture.transactionHash, ID0, TEST_CREATOR, AMOUNT0],
    [{ ...taskCreatedFixture, logs: [{ ...taskCreatedFixture.logs[0], topics: ["0x1234"] }] }, taskCreatedFixture.transactionHash, ID0, TEST_CREATOR, AMOUNT0],
  ];
  for (const [receipt, hash, taskId, creator, amount] of cases) {
    assert.equal(verifyEscrowTaskReceipt(receipt, hash, "TaskCreated", taskId, creator, amount, DO_IT_ESCROW_ABI, ARC_ESCROW), false);
  }
  assert.equal(verifyEscrowRewardReceipt(rewardCreditedFixture, rewardCreditedFixture.transactionHash, ID3, TEST_WORKER, AMOUNT3 + 1n, DO_IT_ESCROW_ABI, ARC_ESCROW), false);
});

test("a non-refund escrow log cannot satisfy refund receipt verification", () => {
  const candidate = { args: { taskId: ID0, creator: TEST_CREATOR, amount: AMOUNT0 }, transactionHash: taskFundedFixture.transactionHash, blockNumber: taskFundedFixture.blockNumber, logIndex: 19 };
  assert.equal(verifyEscrowRefundReceipt(taskFundedFixture, candidate, ID0, TEST_CREATOR, AMOUNT0, DO_IT_ESCROW_ABI, ARC_ESCROW), false);
});

test("refund range pagination is inclusive, gap-free, and uses bounded request counts", async () => {
  const firstBlock = 66340107n;
  const lastBlock = 66997117n;
  const ranges = [];
  const found = await scanRefundLogRanges(firstBlock, lastBlock, async (from, to) => {
    ranges.push([from, to]);
    return [];
  }, async () => false);
  assert.equal(found, false);
  assert.equal(V2_REFUND_SCAN_BLOCK_WINDOW, 10000n);
  assert.equal(ranges.length, 66);
  assert.equal(ranges[0][1], lastBlock);
  assert.equal(ranges.at(-1)[0], firstBlock);
  for (let i = 0; i < ranges.length; i++) {
    assert.ok(ranges[i][1] - ranges[i][0] + 1n <= V2_REFUND_SCAN_BLOCK_WINDOW);
    if (i > 0) assert.equal(ranges[i - 1][0] - ranges[i][1], 1n);
  }
});

test("scanner stops after a verified matching event and propagates incomplete-scan RPC errors", async () => {
  let calls = 0;
  const found = await scanRefundLogRanges(1n, 30000n, async (from, to) => {
    calls++;
    return from === 1n ? ["fixture-refund"] : [];
  }, async (event) => event === "fixture-refund");
  assert.equal(found, true);
  assert.equal(calls, 3);
  await assert.rejects(() => scanRefundLogRanges(1n, 1n, async () => { throw new Error("RPC unavailable"); }, async () => false), /RPC unavailable/);
});

assert.equal(ARC_ESCROW, "0x024539183A57428C63B2F2628b881105213332E4");
