import prisma from "../db.server";
import { DEMO_SHOP } from "./constants";
import { ensureDemoSeed } from "./seed.server";
import {
  listInboundTransfers,
  tryListNativePurchaseOrders,
} from "./shopify-ops.server";
import type { ShopifyAdmin } from "./shopify-ops.server";

function transferNumber(gid: string, index: number) {
  const numeric = gid.split("/").pop();
  return numeric ? `TR-${numeric}` : `TR-${index + 1}`;
}

export async function syncFromShopify(options: {
  shop: string;
  admin: ShopifyAdmin;
  accessToken?: string | null;
}) {
  const notes: string[] = [];
  let imported = 0;

  try {
    const transfers = (await listInboundTransfers(options.admin)) as Array<{
      id: string;
      status?: string;
      destination?: {
        name?: string;
        location?: { id?: string; name?: string };
      };
      origin?: { name?: string };
      lineItems?: {
        nodes: Array<{
          id: string;
          title?: string;
          totalQuantity?: number;
          inventoryItem?: {
            id?: string;
            sku?: string;
            unitCost?: { amount?: string };
            variants?: {
              nodes?: Array<{
                id?: string;
                displayName?: string;
                barcodes?: { nodes?: Array<{ value?: string | null } | null> };
              } | null>;
            };
          };
        }>;
      };
    }>;

    for (const [index, transfer] of transfers.entries()) {
      const number = transferNumber(transfer.id, index);
      const existing = await prisma.purchaseOrder.findFirst({
        where: { shop: options.shop, shopifyTransferGid: transfer.id },
      });
      if (existing) continue;

      const lines = transfer.lineItems?.nodes ?? [];
      if (lines.length === 0) continue;

      await prisma.purchaseOrder.create({
        data: {
          id: `po_tr_${transfer.id.split("/").pop()}`,
          shop: options.shop,
          number,
          supplierName: transfer.origin?.name || "Shopify transfer origin",
          destinationName:
            transfer.destination?.location?.name ||
            transfer.destination?.name ||
            "Destination",
          status: "open",
          notes: `Imported from inventory transfer ${transfer.id}. Receiving happens on the transfer/shipment, not a native PO.`,
          source: "shopify_transfer",
          shopifyTransferGid: transfer.id,
          locationGid: transfer.destination?.location?.id,
          lines: {
            create: lines.map((line) => {
              const variant = line.inventoryItem?.variants?.nodes?.[0];
              return {
                id: `ln_${line.id.split("/").pop()}`,
                sku: line.inventoryItem?.sku || "NO-SKU",
                title: variant?.displayName || line.title || "Untitled",
                barcode: variant?.barcodes?.nodes?.[0]?.value || null,
                quantityOrdered: line.totalQuantity ?? 0,
                quantityReceived: 0,
                unitCost: line.inventoryItem?.unitCost?.amount || "0.0000",
                inventoryItemGid: line.inventoryItem?.id || null,
                variantGid: variant?.id || null,
                shopifyLineGid: line.id,
              };
            }),
          },
        },
      });
      imported += 1;
    }
    notes.push(
      `Imported ${imported} inventory transfer(s) as receive documents.`,
    );
  } catch (error) {
    notes.push(
      `Transfer sync failed: ${error instanceof Error ? error.message : "unknown error"}. Needs read_inventory_transfers.`,
    );
  }

  if (options.accessToken) {
    const native = await tryListNativePurchaseOrders({
      shop: options.shop,
      accessToken: options.accessToken,
    });
    if (native.ok) {
      notes.push(
        `Native inventoryPurchaseOrders (unstable): ${native.nodes.length} row(s). Read-only — Shopify has no public receive-on-PO mutation.`,
      );
    } else {
      notes.push(
        `Native PO query unavailable (${native.message}). Enable the Physical inventory feature preview and call unstable Admin GraphQL.`,
      );
    }
  } else {
    notes.push(
      "Skipped native PO query (no offline access token on this request).",
    );
  }

  const lastSyncNote = notes.join(" ");
  await prisma.shopState.upsert({
    where: { shop: options.shop },
    update: { lastSyncAt: new Date(), lastSyncNote },
    create: {
      shop: options.shop,
      lastSyncAt: new Date(),
      lastSyncNote,
    },
  });

  return { imported, lastSyncNote };
}

export async function getShopState(shop: string) {
  if (shop === DEMO_SHOP) {
    await ensureDemoSeed(shop);
  }
  return prisma.shopState.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
}
