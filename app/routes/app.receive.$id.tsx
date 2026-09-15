import { useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { formatMoney } from "../lib/money";
import { applyReceive, getPurchaseOrder } from "../lib/po.server";
import {
  remainingQuantity,
  shopifyWriteLabel,
  weightedAverageCost,
} from "../lib/receive";
import { requireShop } from "../lib/session.server";
import { formatDate, StatusBadge } from "../lib/ui";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const shop = await requireShop(request);
  const po = await getPurchaseOrder(shop.shop, params.id || "");
  if (!po) {
    throw new Response("Purchase order not found", { status: 404 });
  }
  return { demo: shop.demo, po };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const shop = await requireShop(request);
  const form = await request.formData();
  const poId = params.id || "";
  const po = await getPurchaseOrder(shop.shop, poId);
  if (!po) {
    throw new Response("Purchase order not found", { status: 404 });
  }

  try {
    const input = po.lines.map((line) => ({
      lineId: line.id,
      quantityAccepted: Number(form.get(`qty_${line.id}`) || 0),
      unitCost: String(form.get(`cost_${line.id}`) || line.unitCost),
    }));
    const result = await applyReceive({
      shop: shop.shop,
      purchaseOrderId: poId,
      notes: String(form.get("notes") || ""),
      input,
      admin: shop.admin,
      locationGid: po.locationGid,
    });
    return redirect(
      `/app/receive/${poId}?receipt=${result.receiptId}&write=${result.shopifyResult.status}`,
    );
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Receive failed.",
    };
  }
};

export default function ReceivePage() {
  const { po, demo } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [searchParams] = useSearchParams();
  const urlReceipt = searchParams.get("receipt");

  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(po.lines.map((line) => [line.id, ""])),
  );
  const [costs, setCosts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      po.lines.map((line) => [line.id, line.lockedUnitCost || line.unitCost]),
    ),
  );

  const preview = useMemo(
    () =>
      po.lines.map((line) => {
        const remaining = remainingQuantity(line);
        const qty = Number.parseInt(qtys[line.id] || "0", 10) || 0;
        const unitCost = costs[line.id] || line.unitCost;
        let nextAvg = line.lockedAverageCost;
        try {
          if (qty > 0) {
            nextAvg = weightedAverageCost({
              previousQty: line.quantityReceived,
              previousAvgCost:
                line.lockedAverageCost ?? line.lockedUnitCost ?? line.unitCost,
              receiveQty: qty,
              receiveUnitCost: unitCost,
            });
          }
        } catch {
          nextAvg = line.lockedAverageCost;
        }
        return { remaining, qty, unitCost, nextAvg };
      }),
    [po.lines, qtys, costs],
  );

  const totalThisReceive = preview.reduce((sum, line) => sum + line.qty, 0);
  const canReceive = po.status !== "cancelled" && po.status !== "received";

  const fillRemaining = () => {
    setQtys(
      Object.fromEntries(
        po.lines.map((line) => [line.id, String(remainingQuantity(line) || "")]),
      ),
    );
  };

  return (
    <s-page heading={`Receive ${po.number}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Purchase orders
      </s-link>
      <s-button slot="secondary-actions" href={`/app/labels/${po.id}`}>
        Print labels
      </s-button>

      {urlReceipt ? (
        <s-banner heading="Receipt locked" tone="success">
          Quantities and cost are recorded. Print labels from the received
          lines, or take another partial if units are still outstanding.
        </s-banner>
      ) : null}
      {actionData && !actionData.ok ? (
        <s-banner heading="Could not receive" tone="critical">
          {actionData.message}
        </s-banner>
      ) : null}

      <s-section heading={po.supplierName}>
        <s-stack direction="inline" gap="base">
          <StatusBadge status={po.status} />
          <s-text>{po.destinationName}</s-text>
          <s-text color="subdued">Expected {formatDate(po.expectedOn)}</s-text>
        </s-stack>
        {po.notes ? <s-paragraph>{po.notes}</s-paragraph> : null}
        {demo ? (
          <s-paragraph>
            Cost is locked on this receipt in ReceiveKit. Shopify inventory
            item cost is not written until a store is connected.
          </s-paragraph>
        ) : (
          <s-paragraph>
            On submit, ReceiveKit stores an immutable receipt, then tries{" "}
            <code>inventoryAdjustQuantities</code> and{" "}
            <code>inventoryItemUpdate(cost)</code>.
          </s-paragraph>
        )}
      </s-section>

      <Form method="post">
        <s-section heading="This receipt">
          <div className="rk-actions no-print">
            <s-button type="button" variant="tertiary" onClick={fillRemaining}>
              Fill remaining
            </s-button>
            <s-text color="subdued">
              {totalThisReceive} units in this receive
            </s-text>
          </div>
          <div className="rk-table-wrap">
            <table className="rk-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Ordered</th>
                  <th className="num">Already in</th>
                  <th className="num">Left</th>
                  <th className="num">Accept now</th>
                  <th className="num">Unit cost</th>
                  <th className="num">Avg after</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((line, index) => {
                  const remaining = preview[index].remaining;
                  const complete = remaining === 0;
                  return (
                    <tr key={line.id}>
                      <td>
                        <strong>{line.title}</strong>
                        <div className="rk-muted">
                          {line.sku}
                          {line.barcode ? ` · ${line.barcode}` : ""}
                        </div>
                      </td>
                      <td className="num">{line.quantityOrdered}</td>
                      <td className="num">{line.quantityReceived}</td>
                      <td className="num">{remaining}</td>
                      <td className="num">
                        <input
                          className="rk-input"
                          name={`qty_${line.id}`}
                          type="number"
                          min={0}
                          max={remaining}
                          step={1}
                          disabled={complete || !canReceive}
                          value={qtys[line.id]}
                          onChange={(event) =>
                            setQtys((current) => ({
                              ...current,
                              [line.id]: event.target.value,
                            }))
                          }
                          aria-label={`Accept quantity for ${line.sku}`}
                        />
                      </td>
                      <td className="num">
                        <input
                          className="rk-input"
                          name={`cost_${line.id}`}
                          type="number"
                          min={0}
                          step="0.0001"
                          disabled={!canReceive}
                          value={costs[line.id]}
                          onChange={(event) =>
                            setCosts((current) => ({
                              ...current,
                              [line.id]: event.target.value,
                            }))
                          }
                          aria-label={`Unit cost for ${line.sku}`}
                        />
                      </td>
                      <td className="num">
                        {preview[index].qty > 0 && preview[index].nextAvg
                          ? formatMoney(preview[index].nextAvg)
                          : line.lockedAverageCost
                            ? formatMoney(line.lockedAverageCost)
                            : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <s-box paddingBlockStart="base">
            <label htmlFor="notes">
              <s-text>Receipt note</s-text>
            </label>
            <textarea
              id="notes"
              className="rk-note"
              name="notes"
              placeholder="Carton count, shortage, freight claim…"
            />
          </s-box>
          <s-box paddingBlockStart="base">
            <s-stack direction="inline" gap="base">
              <s-button
                type="submit"
                variant="primary"
                disabled={!canReceive || totalThisReceive === 0}
                {...(submitting ? { loading: true } : {})}
              >
                Receive and lock cost
              </s-button>
              <s-text color="subdued">
                Unit cost on this receipt is stored even if Shopify rejects the
                inventory write.
              </s-text>
            </s-stack>
          </s-box>
        </s-section>
      </Form>

      <s-section heading="Locked receipts">
        {po.receipts.length === 0 ? (
          <s-paragraph>No units received yet.</s-paragraph>
        ) : (
          <div className="rk-table-wrap">
            <table className="rk-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Units</th>
                  <th>Shopify</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {po.receipts.map((receipt) => {
                  const units = receipt.lines.reduce(
                    (sum, line) => sum + line.quantityAccepted,
                    0,
                  );
                  return (
                    <tr key={receipt.id}>
                      <td>{formatDate(receipt.receivedAt)}</td>
                      <td>{units}</td>
                      <td>{shopifyWriteLabel(receipt.shopifyWriteStatus)}</td>
                      <td className="rk-muted">
                        {receipt.shopifyWriteDetail || receipt.notes || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section slot="aside" heading="Cost lock">
        <s-paragraph>
          Each accepted line snapshots <strong>this receipt&apos;s unit cost</strong>{" "}
          and a <strong>PO-weighted average</strong> across receives on this
          document.
        </s-paragraph>
        <s-paragraph>
          Shopify&apos;s public API writes <code>InventoryItem.cost</code> (last
          write wins). There is no shop-wide moving-average ledger mutation.
          ReceiveKit writes the PO-weighted average when an InventoryItem GID
          exists.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
