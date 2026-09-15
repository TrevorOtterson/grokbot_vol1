import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import type { ReceiveLineInput } from "./receive";
import { poStatusFromLines, validateReceive } from "./receive";
import { writeReceiveToShopify, type ShopifyAdmin } from "./shopify-ops.server";

export async function listPurchaseOrders(shop: string) {
  return prisma.purchaseOrder.findMany({
    where: { shop },
    include: { lines: true },
    orderBy: { number: "desc" },
  });
}

export async function getPurchaseOrder(shop: string, id: string) {
  return prisma.purchaseOrder.findFirst({
    where: { shop, id },
    include: {
      lines: { orderBy: { sku: "asc" } },
      receipts: {
        include: { lines: true },
        orderBy: { receivedAt: "desc" },
      },
    },
  });
}

export async function applyReceive(options: {
  shop: string;
  purchaseOrderId: string;
  notes: string;
  input: ReceiveLineInput[];
  admin: ShopifyAdmin | null;
  locationGid?: string | null;
}) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { shop: options.shop, id: options.purchaseOrderId },
    include: { lines: true },
  });
  if (!po) {
    throw new Error("Purchase order not found.");
  }
  if (po.status === "cancelled") {
    throw new Error("This purchase order is cancelled.");
  }

  const accepted = validateReceive(po.lines, options.input);
  const receiptId = randomUUID();

  const shopifyResult = options.admin
    ? await writeReceiveToShopify({
        admin: options.admin,
        accessToken: null,
        shop: options.shop,
        locationGid: options.locationGid || po.locationGid,
        transferGid: po.shopifyTransferGid,
        lines: accepted.map((row) => {
          const line = po.lines.find((item) => item.id === row.lineId)!;
          return {
            lineId: row.lineId,
            sku: line.sku,
            inventoryItemGid: line.inventoryItemGid,
            shopifyLineGid: line.shopifyLineGid,
            quantityAccepted: row.quantityAccepted,
            unitCost: row.unitCost,
            averageCostWritten: row.averageCostWritten,
          };
        }),
      })
    : {
        status: "demo" as const,
        detail: "Demo mode — quantity and cost locked in ReceiveKit only.",
        lines: accepted.map((row) => ({
          lineId: row.lineId,
          qtyOk: false,
          costOk: false,
        })),
      };

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.receipt.create({
      data: {
        id: receiptId,
        shop: options.shop,
        purchaseOrderId: po.id,
        notes: options.notes || null,
        shopifyWriteStatus: shopifyResult.status,
        shopifyWriteDetail: shopifyResult.detail,
        lines: {
          create: accepted.map((row) => {
            const shopifyLine = shopifyResult.lines.find(
              (item) => item.lineId === row.lineId,
            );
            return {
              id: randomUUID(),
              purchaseOrderLineId: row.lineId,
              quantityAccepted: row.quantityAccepted,
              unitCost: row.unitCost,
              averageCostWritten: row.averageCostWritten,
              shopifyQtyOk: shopifyLine?.qtyOk ?? false,
              shopifyCostOk: shopifyLine?.costOk ?? false,
            };
          }),
        },
      },
    });

    for (const row of accepted) {
      const line = po.lines.find((item) => item.id === row.lineId)!;
      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: {
          quantityReceived: line.quantityReceived + row.quantityAccepted,
          lockedUnitCost: row.unitCost,
          lockedAverageCost: row.averageCostWritten,
          costLockedAt: now,
        },
      });
    }

    const refreshed = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: po.id },
    });
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: poStatusFromLines(refreshed) },
    });
  });

  return { receiptId, shopifyResult };
}
