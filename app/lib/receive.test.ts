import assert from "node:assert/strict";
import test from "node:test";
import {
  poStatusFromLines,
  remainingQuantity,
  validateReceive,
  weightedAverageCost,
} from "./receive";

test("remaining quantity never goes negative", () => {
  assert.equal(remainingQuantity({ quantityOrdered: 10, quantityReceived: 4 }), 6);
  assert.equal(remainingQuantity({ quantityOrdered: 10, quantityReceived: 10 }), 0);
  assert.equal(remainingQuantity({ quantityOrdered: 10, quantityReceived: 12 }), 0);
});

test("PO status follows partial receives", () => {
  assert.equal(
    poStatusFromLines([{ quantityOrdered: 10, quantityReceived: 0 }]),
    "open",
  );
  assert.equal(
    poStatusFromLines([{ quantityOrdered: 10, quantityReceived: 3 }]),
    "partial",
  );
  assert.equal(
    poStatusFromLines([
      { quantityOrdered: 4, quantityReceived: 4 },
      { quantityOrdered: 2, quantityReceived: 2 },
    ]),
    "received",
  );
});

test("weighted average uses prior received qty on the PO", () => {
  assert.equal(
    weightedAverageCost({
      previousQty: 10,
      previousAvgCost: "10.0000",
      receiveQty: 10,
      receiveUnitCost: "20",
    }),
    "15.0000",
  );
});

test("validateReceive rejects over-receive and empty submits", () => {
  const lines = [
    {
      id: "line-1",
      quantityOrdered: 8,
      quantityReceived: 2,
      unitCost: "12.00",
      lockedUnitCost: "12.00",
      lockedAverageCost: "12.00",
    },
  ];

  assert.throws(
    () =>
      validateReceive(lines, [
        { lineId: "line-1", quantityAccepted: 9, unitCost: "12.50" },
      ]),
    /remaining/,
  );

  assert.throws(
    () =>
      validateReceive(lines, [
        { lineId: "line-1", quantityAccepted: 0, unitCost: "12.50" },
      ]),
    /at least one/,
  );

  const accepted = validateReceive(lines, [
    { lineId: "line-1", quantityAccepted: 3, unitCost: "18" },
  ]);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].averageCostWritten, "15.6000");
});
