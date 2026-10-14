export const V2_REFUND_SCAN_BLOCK_WINDOW = 10_000n;

/** Scan inclusive, descending block ranges without gaps; RPC errors propagate to the fail-closed caller. */
export async function scanRefundLogRanges<T>(
  firstBlock: bigint,
  lastBlock: bigint,
  fetchEvents: (fromBlock: bigint, toBlock: bigint) => Promise<readonly T[]>,
  verifyEvent: (event: T) => Promise<boolean>,
  blockWindow = V2_REFUND_SCAN_BLOCK_WINDOW,
): Promise<boolean> {
  if (firstBlock < 0n || lastBlock < firstBlock || blockWindow < 1n) return false;

  let toBlock = lastBlock;
  while (toBlock >= firstBlock) {
    const fromBlock = toBlock - firstBlock + 1n > blockWindow
      ? toBlock - blockWindow + 1n
      : firstBlock;
    const events = await fetchEvents(fromBlock, toBlock);
    for (const event of events) {
      if (await verifyEvent(event)) return true;
    }
    if (fromBlock === firstBlock) break;
    toBlock = fromBlock - 1n;
  }
  return false;
}
