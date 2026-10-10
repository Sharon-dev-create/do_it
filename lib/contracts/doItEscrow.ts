export const DO_IT_ESCROW_ADDRESS =
  "0x024539183A57428C63B2F2628b881105213332E4" as const;

// Kept in one shared definition for browser reads and server verification.
export const DO_IT_ESCROW_ABI = [
  { type: "function", name: "createTask", stateMutability: "nonpayable", inputs: [{ name: "reward", type: "uint256" }], outputs: [{ name: "taskId", type: "uint256" }] },
  { type: "function", name: "fundTask", stateMutability: "nonpayable", inputs: [{ name: "taskId", type: "uint256" }], outputs: [] },
  { type: "function", name: "claimTask", stateMutability: "nonpayable", inputs: [{ name: "taskId", type: "uint256" }], outputs: [] },
  { type: "function", name: "releaseReward", stateMutability: "nonpayable", inputs: [{ name: "taskId", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "refundTask", stateMutability: "nonpayable", inputs: [{ name: "taskId", type: "uint256" }], outputs: [] },
  { type: "function", name: "tasks", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "creator", type: "address" }, { name: "worker", type: "address" }, { name: "reward", type: "uint256" }, { name: "status", type: "uint8" }] },
  { type: "function", name: "nextTaskId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "verifier", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "usdc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "availableBalance", stateMutability: "view", inputs: [{ name: "worker", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalWithdrawableEarnings", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "outstandingTaskLiabilities", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "isSolvent", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "event", name: "TaskCreated", inputs: [{ name: "taskId", type: "uint256", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "reward", type: "uint256", indexed: false }] },
  { type: "event", name: "TaskFunded", inputs: [{ name: "taskId", type: "uint256", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "TaskClaimed", inputs: [{ name: "taskId", type: "uint256", indexed: true }, { name: "worker", type: "address", indexed: true }] },
  { type: "event", name: "RewardCredited", inputs: [{ name: "taskId", type: "uint256", indexed: true }, { name: "worker", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "EarningsWithdrawn", inputs: [{ name: "worker", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "TaskRefunded", inputs: [{ name: "taskId", type: "uint256", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
] as const;
