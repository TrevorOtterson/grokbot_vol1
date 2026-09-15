import assert from "node:assert/strict";
import test from "node:test";
import { moneyString, parseMoney, roundMoney } from "./money";

test("parseMoney rejects blanks and negatives", () => {
  assert.equal(parseMoney("4.5"), 4.5);
  assert.throws(() => parseMoney(""), /required/);
  assert.throws(() => parseMoney("-1"), /0 or greater/);
});

test("moneyString keeps four decimal places", () => {
  assert.equal(moneyString(12.5), "12.5000");
  assert.equal(moneyString(roundMoney(1 / 3)), "0.3333");
});
