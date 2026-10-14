// Sanitized event logs derived from successful Arc Testnet receipts listed in security-validation-report.md.
// Transaction hashes and indexed wallet addresses are replaced; event topics/signatures and amount data are retained.
export const ARC_ESCROW = "0x024539183A57428C63B2F2628b881105213332E4";
export const TEST_CREATOR = "0x1111111111111111111111111111111111111111";
export const TEST_WORKER = "0x2222222222222222222222222222222222222222";

const fixtureHash = (char) => `0x${char.repeat(64)}`;
const creatorTopic = `0x${"0".repeat(24)}${TEST_CREATOR.slice(2).toLowerCase()}`;
const workerTopic = `0x${"0".repeat(24)}${TEST_WORKER.slice(2).toLowerCase()}`;
const taskTopic = (id) => `0x${id.toString(16).padStart(64, "0")}`;
const amountData = (amount) => `0x${amount.toString(16).padStart(64, "0")}`;

export const taskCreatedFixture = {
  transactionHash: fixtureHash("a"), blockNumber: 66414004n, status: "success", to: ARC_ESCROW,
  logs: [{ address: ARC_ESCROW, topics: ["0x6cf53aa7292e664152c2ea948c3b3c95d4b05c36daeb2626d0293473c4a4a153", taskTopic(0), creatorTopic], data: amountData(10000n), blockNumber: 66414004n, logIndex: 8 }],
};
export const taskFundedFixture = {
  transactionHash: fixtureHash("b"), blockNumber: 66414049n, status: "success", to: ARC_ESCROW,
  logs: [{ address: ARC_ESCROW, topics: ["0x9c49807a23f4d5f56e8d93c1add31e749bd0cdf1025eefe36f906ba31c0dfc68", taskTopic(0), creatorTopic], data: amountData(10000n), blockNumber: 66414049n, logIndex: 19 }],
};
export const rewardCreditedFixture = {
  transactionHash: fixtureHash("c"), blockNumber: 66921626n, status: "success", to: ARC_ESCROW,
  logs: [{ address: ARC_ESCROW, topics: ["0x9042fa19125de5f8ba6ff122ffb7e5ecee4a5635a32561219e061e07fa30a961", taskTopic(3), workerTopic], data: amountData(100000n), blockNumber: 66921626n, logIndex: 33 }],
};
