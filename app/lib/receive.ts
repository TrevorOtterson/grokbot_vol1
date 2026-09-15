import { parseMoney, roundMoney, moneyString } from "./money";

export type PoStatus = "open" | "partial" | "received" | "cancelled";

export type ReceiveLineInput = {
  lineId: string;
  quantityAccepted: number;
  unitCost: string;
};

export type LineSnapshot = {
  id: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: string;
  lockedUnitCost: string | null;
  lockedAverageCost: string | null;
};

export function remainingQuantity(line: {
  quantityOrdered: number;
  quantityReceived: number;
}): number {
  return Math.max(0, line.quantityOrdered - line.quantityReceived);
}

export function poStatusFromLines(
  lines: { quantityOrdered: number; quantityReceived: number }[],
): PoStatus {
  if (lines.length === 0) return "open";
  const ordered = lines.reduce((sum, line) => sum + line.quantityOrdered, 0);
  const received = lines.reduce((sum, line) => sum + line.quantityReceived, 0);
  if (received <= 0) return "open";
  if (received >= ordered) return "received";
  return "partial";
}

export function weightedAverageCost(options: {
  previousQty: number;
  previousAvgCost: string | number;
  receiveQty: number;
  receiveUnitCost: string | number;
}): string {
  const previousQty = options.previousQty;
  const receiveQty = options.receiveQty;
  const previousCost = parseMoney(options.previousAvgCost);
  const receiveCost = parseMoney(options.receiveUnitCost);
  const totalQty = previousQty + receiveQty;
  if (totalQty <= 0) return moneyString(receiveCost);
  const avg =
    (previousQty * previousCost + receiveQty * receiveCost) / totalQty;
  return moneyString(roundMoney(avg));
}

export function validateReceive(lines: LineSnapshot[], input: ReceiveLineInput[]) {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const accepted: Array<
    ReceiveLineInput & {
      remaining: number;
      previousAvgCost: string;
      averageCostWritten: string;
    }
  > = [];

  for (const row of input) {
    const line = byId.get(row.lineId);
    if (!line) {
      throw new Error("A receive line is missing from this purchase order.");
    }
    if (!Number.isInteger(row.quantityAccepted) || row.quantityAccepted < 0) {
      throw new Error(`Quantity for ${line.id} must be a whole number.`);
    }
    if (row.quantityAccepted === 0) continue;
    const remaining = remainingQuantity(line);
    if (row.quantityAccepted > remaining) {
      throw new Error(
        `Cannot receive ${row.quantityAccepted} on a line with ${remaining} remaining.`,
      );
    }
    parseMoney(row.unitCost);
    const previousAvgCost = line.lockedAverageCost ?? line.lockedUnitCost ?? line.unitCost;
    accepted.push({
      ...row,
      remaining,
      previousAvgCost,
      averageCostWritten: weightedAverageCost({
        previousQty: line.quantityReceived,
        previousAvgCost,
        receiveQty: row.quantityAccepted,
        receiveUnitCost: row.unitCost,
      }),
    });
  }

  if (accepted.length === 0) {
    throw new Error("Enter at least one quantity to receive.");
  }

  return accepted;
}

export function shopifyWriteLabel(status: string) {
  if (status === "written") return "Shopify qty + cost written";
  if (status === "partial") return "Shopify write partial";
  if (status === "skipped") return "Locked in ReceiveKit only";
  return "Demo — not written to Shopify";
}
