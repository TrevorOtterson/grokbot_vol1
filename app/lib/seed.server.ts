import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import { DEMO_SHOP } from "./constants";

const demoPos = [
  {
    id: "po_open_apex",
    number: "PO-1042",
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

export async function ensureDemoSeed(shop = DEMO_SHOP) {
  await prisma.shopState.upsert({
    where: { shop },
    update: {},
    create: {
      shop,
      plan: "dock",
      billingStatus: "demo",
      lastSyncNote: "Demo catalog. Shopify Admin is not connected.",
    },
  });

  const existing = await prisma.purchaseOrder.count({ where: { shop } });
  if (existing > 0) return { shop, seeded: false };

  for (const po of demoPos) {
    await prisma.purchaseOrder.create({
      data: {
        id: po.id,
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
            id: `${po.id}_${line.sku}`,
            sku: line.sku,
            title: line.title,
            barcode: line.barcode,
            quantityOrdered: line.quantityOrdered,
            quantityReceived: line.quantityReceived,
            unitCost: line.unitCost,
            lockedUnitCost: "lockedUnitCost" in line ? line.lockedUnitCost : null,
            lockedAverageCost:
              "lockedAverageCost" in line ? line.lockedAverageCost : null,
            costLockedAt:
              line.quantityReceived > 0 ? daysFromNow(-1) : null,
          })),
        },
      },
    });
  }

  const partial = demoPos[1];
  const tote = partial.lines[0];
  const cap = partial.lines[1];
  await prisma.receipt.create({
    data: {
      id: "rcpt_northline_1",
      shop,
      purchaseOrderId: partial.id,
      receivedAt: daysFromNow(-3),
      notes: "First pallet.",
      shopifyWriteStatus: "demo",
      shopifyWriteDetail: "Demo seed — no Shopify write.",
      lines: {
        create: [
          {
            id: randomUUID(),
            purchaseOrderLineId: `${partial.id}_${tote.sku}`,
            quantityAccepted: tote.quantityReceived,
            unitCost: tote.unitCost,
            averageCostWritten: tote.unitCost,
          },
          {
            id: randomUUID(),
            purchaseOrderLineId: `${partial.id}_${cap.sku}`,
            quantityAccepted: cap.quantityReceived,
            unitCost: cap.unitCost,
            averageCostWritten: cap.unitCost,
          },
        ],
      },
    },
  });

  const received = demoPos[2];
  await prisma.receipt.create({
    data: {
      id: "rcpt_harbor_1",
      shop,
      purchaseOrderId: received.id,
      receivedAt: daysFromNow(-18),
      notes: "Full receipt.",
      shopifyWriteStatus: "demo",
      shopifyWriteDetail: "Demo seed — no Shopify write.",
      lines: {
        create: received.lines.map((line) => ({
          id: randomUUID(),
          purchaseOrderLineId: `${received.id}_${line.sku}`,
          quantityAccepted: line.quantityReceived,
          unitCost: line.lockedUnitCost ?? line.unitCost,
          averageCostWritten: line.lockedAverageCost ?? line.unitCost,
        })),
      },
    },
  });

  return { shop, seeded: true };
}
