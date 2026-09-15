export type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ShopifyWriteLine = {
  sku: string;
  inventoryItemGid: string | null;
  shopifyLineGid: string | null;
  quantityAccepted: number;
  unitCost: string;
  averageCostWritten: string;
};

export type ShopifyWriteResult = {
  status: "demo" | "written" | "partial" | "skipped";
  detail: string;
  lines: Array<{ lineId: string; qtyOk: boolean; costOk: boolean }>;
};

const TRANSFERS_QUERY = `#graphql
  query ReceiveKitTransfers($first: Int!) {
    inventoryTransfers(first: $first, sortKey: ID, reverse: true) {
      nodes {
        id
        dateCreated
        status
        name: id
        destination { name location { id name } }
        origin { name }
        lineItems(first: 100) {
          nodes {
            id
            title
            totalQuantity
            shippedQuantity
            inventoryItem {
              id
              sku
              unitCost { amount currencyCode }
              variant { id barcode displayName }
            }
          }
        }
      }
    }
  }
`;

const LOCATIONS_QUERY = `#graphql
  query ReceiveKitLocations {
    locations(first: 10, includeInactive: false) {
      nodes { id name isActive }
    }
  }
`;

const ADJUST_QTY = `#graphql
  mutation ReceiveKitAdjust($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      userErrors { field message }
    }
  }
`;

const UPDATE_COST = `#graphql
  mutation ReceiveKitCost($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id unitCost { amount currencyCode } }
      userErrors { field message }
    }
  }
`;

const NATIVE_POS_QUERY = `#graphql
  query ReceiveKitPurchaseOrders($first: Int!) {
    inventoryPurchaseOrders(first: $first) {
      nodes {
        id
        name
        status
        supplier { name }
        lineItems(first: 50) {
          nodes { title supplierSku totalQuantity }
        }
      }
    }
  }
`;

type GraphqlPayload = {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
};

async function graphqlJson(
  admin: ShopifyAdmin,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphqlPayload> {
  const response = await admin.graphql(query, { variables });
  return (await response.json()) as GraphqlPayload;
}

function userErrorText(errors: Array<{ message?: string }> | undefined) {
  return (errors ?? []).map((error) => error.message).filter(Boolean).join("; ");
}

export async function listShopifyLocations(admin: ShopifyAdmin) {
  try {
    const json = await graphqlJson(admin, LOCATIONS_QUERY);
    const nodes =
      (
        json.data as {
          locations?: { nodes: Array<{ id: string; name: string; isActive: boolean }> };
        }
      )?.locations?.nodes ?? [];
    return nodes.filter((location) => location.isActive);
  } catch (error) {
    return [] as Array<{ id: string; name: string; isActive: boolean }>;
  }
}

export async function listInboundTransfers(admin: ShopifyAdmin) {
  const json = await graphqlJson(admin, TRANSFERS_QUERY, { first: 25 });
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  return (
    (
      json.data as {
        inventoryTransfers?: { nodes: unknown[] };
      }
    )?.inventoryTransfers?.nodes ?? []
  );
}

export async function tryListNativePurchaseOrders(options: {
  shop: string;
  accessToken: string;
}) {
  const response = await fetch(
    `https://${options.shop}/admin/api/unstable/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": options.accessToken,
      },
      body: JSON.stringify({
        query: NATIVE_POS_QUERY,
        variables: { first: 25 },
      }),
    },
  );
  const json = (await response.json()) as GraphqlPayload;
  if (!response.ok || json.errors?.length) {
    const message =
      json.errors?.map((error) => error.message).join("; ") ||
      `HTTP ${response.status}`;
    return { ok: false as const, message, nodes: [] as unknown[] };
  }
  const nodes =
    (
      json.data as {
        inventoryPurchaseOrders?: { nodes: unknown[] };
      }
    )?.inventoryPurchaseOrders?.nodes ?? [];
  return { ok: true as const, message: `Read ${nodes.length} native POs.`, nodes };
}

export async function writeReceiveToShopify(options: {
  admin: ShopifyAdmin;
  accessToken: string | null;
  shop: string;
  locationGid?: string | null;
  transferGid?: string | null;
  lines: Array<ShopifyWriteLine & { lineId?: string }>;
}): Promise<ShopifyWriteResult> {
  const details: string[] = [];
  const results: ShopifyWriteResult["lines"] = [];

  if (!options.locationGid) {
    const locations = await listShopifyLocations(options.admin);
    options.locationGid = locations[0]?.id ?? null;
  }

  for (const line of options.lines) {
    const lineId = line.lineId ?? line.sku;
    let qtyOk = false;
    let costOk = false;

    if (line.inventoryItemGid && options.locationGid) {
      try {
        const qtyJson = await graphqlJson(options.admin, ADJUST_QTY, {
          input: {
            reason: "received",
            name: "available",
            changes: [
              {
                inventoryItemId: line.inventoryItemGid,
                locationId: options.locationGid,
                delta: line.quantityAccepted,
              },
            ],
          },
        });
        const qtyErrors = (
          qtyJson.data as {
            inventoryAdjustQuantities?: { userErrors: Array<{ message: string }> };
          }
        )?.inventoryAdjustQuantities?.userErrors;
        const qtyErrorText =
          userErrorText(qtyErrors) ||
          qtyJson.errors?.map((error) => error.message).join("; ");
        if (qtyErrorText) {
          details.push(`${line.sku} qty: ${qtyErrorText}`);
        } else {
          qtyOk = true;
        }
      } catch (error) {
        details.push(
          `${line.sku} qty: ${error instanceof Error ? error.message : "adjust failed"}`,
        );
      }
    } else {
      details.push(
        `${line.sku}: skipped inventory adjust (no inventory item or location GID).`,
      );
    }

    if (line.inventoryItemGid) {
      try {
        const costJson = await graphqlJson(options.admin, UPDATE_COST, {
          id: line.inventoryItemGid,
          input: { cost: line.averageCostWritten },
        });
        const costErrors = (
          costJson.data as {
            inventoryItemUpdate?: { userErrors: Array<{ message: string }> };
          }
        )?.inventoryItemUpdate?.userErrors;
        const costErrorText =
          userErrorText(costErrors) ||
          costJson.errors?.map((error) => error.message).join("; ");
        if (costErrorText) {
          details.push(`${line.sku} cost: ${costErrorText}`);
        } else {
          costOk = true;
        }
      } catch (error) {
        details.push(
          `${line.sku} cost: ${error instanceof Error ? error.message : "cost write failed"}`,
        );
      }
    } else {
      details.push(`${line.sku}: skipped cost write (no InventoryItem GID).`);
    }

    results.push({ lineId, qtyOk, costOk });
  }

  const anyOk = results.some((line) => line.qtyOk || line.costOk);
  const allOk =
    results.length > 0 && results.every((line) => line.qtyOk && line.costOk);

  if (!anyOk) {
    return {
      status: "skipped",
      detail:
        details.join(" ") ||
        "Shopify write skipped — lines have no InventoryItem GIDs. Receive is locked in ReceiveKit.",
      lines: results,
    };
  }

  return {
    status: allOk ? "written" : "partial",
    detail: details.join(" ") || "Wrote quantity and unit cost to Shopify.",
    lines: results,
  };
}

export function shopifyWriteLabel(status: string) {
  if (status === "written") return "Shopify qty + cost written";
  if (status === "partial") return "Shopify write partial";
  if (status === "skipped") return "Locked in ReceiveKit only";
  return "Demo — not written to Shopify";
}
