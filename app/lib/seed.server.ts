import { createHash, randomUUID } from "node:crypto";
import prisma from "../db.server";
import { DEMO_SHOP, SAMPLE_OPEN_PO_NUMBER } from "./constants";

const demoPos = [
  {
    id: "po_open_apex",
    number: SAMPLE_OPEN_PO_NUMBER,
    supplierName: "Apex Apparel Co.",
    destinationName: "Warehouse A — receiving dock",
    expectedOn: daysFromNow(2),
    status: "open",
    notes: "Cartons marked MIX-SUMMER. Count inner packs before putting away.",
    source: "app",
    lines: [
      {
        sku: "TEE-WHT-S",
        title: "Heavyweight tee — white / S",
        barcode: "0123456789012",
        quantityOrdered: 48,
        quantityReceived: 0,
        unitCost: "6.4000",
      },
      {
        sku: "TEE-WHT-M",
        title: "Heavyweight tee — white / M",
        barcode: "0123456789029",
        quantityOrdered: 72,
        quantityReceived: 0,
        unitCost: "6.4000",
      },
      {
        sku: "TEE-WHT-L",
        title: "Heavyweight tee — white / L",
        barcode: "0123456789036",
        quantityOrdered: 72,
        quantityReceived: 0,
        unitCost: "6.4000",
      },
      {
        sku: "HOOD-NAVY-M",
        title: "Fleece hoodie — navy / M",
        barcode: "0123456789104",
        quantityOrdered: 24,
        quantityReceived: 0,
        unitCost: "18.7500",
      },
    ],
  },
  {
    id: "po_partial_northline",
    number: "PO-1038",
    supplierName: "Northline Goods",
    destinationName: "Warehouse A — receiving dock",
    expectedOn: daysFromNow(-3),
    status: "partial",
    notes: "First pallet arrived Friday. Balance on next truck.",
    source: "app",
    lines: [
      {
        sku: "TOTE-CANVAS",
        title: "Canvas tote — natural",
        barcode: "7987654321012",
        quantityOrdered: 100,
        quantityReceived: 40,
        unitCost: "3.1000",
        lockedUnitCost: "3.1000",
        lockedAverageCost: "3.1000",
      },
      {
        sku: "CAP-UNSTR",
        title: "Unstructured cap — black",
        barcode: "7987654321029",
        quantityOrdered: 60,
        quantityReceived: 60,
        unitCost: "4.8500",
        lockedUnitCost: "4.8500",
        lockedAverageCost: "4.8500",
      },
      {
        sku: "SOCK-ANKLE",
        title: "Ankle sock 3-pack",
        barcode: "7987654321036",
        quantityOrdered: 80,
        quantityReceived: 0,
        unitCost: "2.2000",
      },
    ],
  },
  {
    id: "po_received_harbor",
    number: "PO-1021",
    supplierName: "Harbor Knit Mills",
    destinationName: "Retail loft — back stock",
    expectedOn: daysFromNow(-18),
    status: "received",
    notes: "Fully received. Reprint labels from this PO if needed.",
    source: "app",
    lines: [
      {
        sku: "BEANIE-RIB",
        title: "Rib beanie — oatmeal",
        barcode: "5544332211001",
        quantityOrdered: 36,
        quantityReceived: 36,
        unitCost: "5.0000",
        lockedUnitCost: "4.8500",
        lockedAverageCost: "4.8500",
      },
      {
        sku: "SCARF-WOOL",
        title: "Wool scarf — charcoal",
        barcode: "5544332211018",
        quantityOrdered: 18,
        quantityReceived: 18,
        unitCost: "9.2500",
        lockedUnitCost: "9.2500",
        lockedAverageCost: "9.2500",
      },
    ],
  },
];

function daysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(12, 0, 0, 0);
  return date;
}

/** Stable per-shop suffix so sample PO/receipt ids do not collide across shops. */
export function shopSeedKey(shop: string) {
  if (shop === DEMO_SHOP) return "";
  const base = shop
    .toLowerCase()
    .replace(/\.myshopify\.com$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  const hash = createHash("sha256").update(shop).digest("hex").slice(0, 8);
  return `${base || "shop"}_${hash}`;
}

export function scopedSeedId(shop: string, id: string) {
  const key = shopSeedKey(shop);
  return key ? `${id}_${key}` : id;
}

export function seededReadyMessage() {
  return `3 sample POs ready — open ${SAMPLE_OPEN_PO_NUMBER} to receive.`;
}

export async function ensureDemoSeed(shop = DEMO_SHOP) {
  const demoShop = shop === DEMO_SHOP;

  await prisma.shopState.upsert({
    where: { shop },
    update: {},
    create: demoShop
      ? {
          shop,
          plan: "dock",
          billingStatus: "demo",
          lastSyncNote: "Demo catalog. Shopify Admin is not connected.",
        }
      : {
          shop,
          lastSyncNote:
            "Empty dock — sync Shopify transfers or seed sample receives.",
        },
  });

  const existing = await prisma.purchaseOrder.count({ where: { shop } });
  if (existing > 0) return { shop, seeded: false, count: existing };

  const idFor = (id: string) => scopedSeedId(shop, id);

  for (const po of demoPos) {
    const poId = idFor(po.id);
    await prisma.purchaseOrder.create({
      data: {
        id: poId,
        shop,
        number: po.number,
        supplierName: po.supplierName,
        destinationName: po.destinationName,
        expectedOn: po.expectedOn,
        status: po.status,
        notes: po.notes,
        source: po.source,
        lines: {
          create: po.lines.map((line) => ({
            id: `${poId}_${line.sku}`,
            sku: line.sku,
            title: line.title,
            barcode: line.barcode,
            quantityOrdered: line.quantityOrdered,
            quantityReceived: line.quantityReceived,
            unitCost: line.unitCost,
            lockedUnitCost: "lockedUnitCost" in line ? line.lockedUnitCost : null,
            lockedAverageCost:
              "lockedAverageCost" in line ? line.lockedAverageCost : null,
            costLockedAt: line.quantityReceived > 0 ? daysFromNow(-1) : null,
          })),
        },
      },
    });
  }

  const partial = demoPos[1];
  const partialId = idFor(partial.id);
  const tote = partial.lines[0];
  const cap = partial.lines[1];
  await prisma.receipt.create({
    data: {
      id: idFor("rcpt_northline_1"),
      shop,
      purchaseOrderId: partialId,
      receivedAt: daysFromNow(-3),
      notes: "First pallet.",
      shopifyWriteStatus: "demo",
      shopifyWriteDetail: "Sample receive — no Shopify write.",
      lines: {
        create: [
          {
            id: randomUUID(),
            purchaseOrderLineId: `${partialId}_${tote.sku}`,
            quantityAccepted: tote.quantityReceived,
            unitCost: tote.unitCost,
            averageCostWritten: tote.unitCost,
          },
          {
            id: randomUUID(),
            purchaseOrderLineId: `${partialId}_${cap.sku}`,
            quantityAccepted: cap.quantityReceived,
            unitCost: cap.unitCost,
            averageCostWritten: cap.unitCost,
          },
        ],
      },
    },
  });

  const received = demoPos[2];
  const receivedId = idFor(received.id);
  await prisma.receipt.create({
    data: {
      id: idFor("rcpt_harbor_1"),
      shop,
      purchaseOrderId: receivedId,
      receivedAt: daysFromNow(-18),
      notes: "Full receipt.",
      shopifyWriteStatus: "demo",
      shopifyWriteDetail: "Sample receive — no Shopify write.",
      lines: {
        create: received.lines.map((line) => ({
          id: randomUUID(),
          purchaseOrderLineId: `${receivedId}_${line.sku}`,
          quantityAccepted: line.quantityReceived,
          unitCost: line.lockedUnitCost ?? line.unitCost,
          averageCostWritten: line.lockedAverageCost ?? line.unitCost,
        })),
      },
    },
  });

  if (!demoShop) {
    await prisma.shopState.update({
      where: { shop },
      data: {
        lastSyncNote: `${seededReadyMessage()} Practice data, not Shopify transfers.`,
      },
    });
  }

  return { shop, seeded: true, count: demoPos.length };
}
