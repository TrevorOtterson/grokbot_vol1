import assert from "node:assert/strict";
import test, { after } from "node:test";
import { DEMO_SHOP, SAMPLE_OPEN_PO_NUMBER } from "./constants";
import prisma from "../db.server";
import { ensureDemoSeed, shopSeedKey, scopedSeedId } from "./seed.server";

test("demo shop keeps stable global seed ids", () => {
  assert.equal(shopSeedKey(DEMO_SHOP), "");
  assert.equal(scopedSeedId(DEMO_SHOP, "po_open_apex"), "po_open_apex");
  assert.equal(scopedSeedId(DEMO_SHOP, "rcpt_northline_1"), "rcpt_northline_1");
});

test("partner shops get unique seed ids that do not collide with demo", () => {
  const shopA = "receivekit-dev.myshopify.com";
  const shopB = "another-dev.myshopify.com";
  const idA = scopedSeedId(shopA, "po_open_apex");
  const idB = scopedSeedId(shopB, "po_open_apex");

  assert.notEqual(idA, "po_open_apex");
  assert.notEqual(idB, "po_open_apex");
  assert.notEqual(idA, idB);
  assert.match(idA, /^po_open_apex_receivekit_dev_[a-f0-9]{8}$/);
  assert.equal(scopedSeedId(shopA, "po_open_apex"), idA);
});

test("ensureDemoSeed is shop-scoped and idempotent", async () => {
  const shopA = "qa-seed-a.myshopify.com";
  const shopB = "qa-seed-b.myshopify.com";

  await prisma.purchaseOrder.deleteMany({ where: { shop: { in: [shopA, shopB] } } });
  await prisma.shopState.deleteMany({ where: { shop: { in: [shopA, shopB] } } });

  try {
    const firstA = await ensureDemoSeed(shopA);
    const firstB = await ensureDemoSeed(shopB);
    const againA = await ensureDemoSeed(shopA);

    assert.equal(firstA.seeded, true);
    assert.equal(firstB.seeded, true);
    assert.equal(againA.seeded, false);

    const posA = await prisma.purchaseOrder.findMany({ where: { shop: shopA } });
    const posB = await prisma.purchaseOrder.findMany({ where: { shop: shopB } });
    assert.equal(posA.length, 3);
    assert.equal(posB.length, 3);
    assert.deepEqual(
      posA.map((po) => po.number).sort(),
      [SAMPLE_OPEN_PO_NUMBER, "PO-1038", "PO-1021"].sort(),
    );
    assert.deepEqual(
      posA.map((po) => po.number).sort(),
      posB.map((po) => po.number).sort(),
    );

    const idsA = new Set(posA.map((po) => po.id));
    for (const po of posB) {
      assert.equal(idsA.has(po.id), false);
    }
    assert.equal(idsA.has("po_open_apex"), false);
  } finally {
    await prisma.purchaseOrder.deleteMany({ where: { shop: { in: [shopA, shopB] } } });
    await prisma.shopState.deleteMany({ where: { shop: { in: [shopA, shopB] } } });
  }
});

after(async () => {
  await prisma.$disconnect();
});
