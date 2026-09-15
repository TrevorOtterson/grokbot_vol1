import assert from "node:assert/strict";
import test, { after } from "node:test";
import prisma from "../db.server";
import { redactShopData } from "./gdpr.server";
import { ensureDemoSeed } from "./seed.server";

test("redactShopData deletes sessions, shop state, POs, and receipts", async () => {
  const shop = "gdpr-redact-test.myshopify.com";

  await redactShopData(shop);
  await ensureDemoSeed(shop);
  await prisma.session.create({
    data: {
      id: "gdpr-session-test",
      shop,
      state: "test",
      isOnline: false,
      accessToken: "not-a-real-token",
    },
  });

  assert.equal(await prisma.purchaseOrder.count({ where: { shop } }), 3);
  assert.equal(await prisma.receipt.count({ where: { shop } }), 2);
  assert.equal(await prisma.session.count({ where: { shop } }), 1);
  assert.equal(await prisma.shopState.count({ where: { shop } }), 1);

  await redactShopData(shop);

  assert.equal(await prisma.purchaseOrder.count({ where: { shop } }), 0);
  assert.equal(await prisma.receipt.count({ where: { shop } }), 0);
  assert.equal(await prisma.session.count({ where: { shop } }), 0);
  assert.equal(await prisma.shopState.count({ where: { shop } }), 0);
});

after(async () => {
  await prisma.$disconnect();
});
