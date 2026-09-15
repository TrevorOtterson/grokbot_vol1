import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import JsBarcode from "jsbarcode";
import { formatMoney } from "../lib/money";
import { getPurchaseOrder } from "../lib/po.server";
import { requireShop } from "../lib/session.server";
import { formatDate } from "../lib/ui";
import labelStyles from "../styles/labels.css?url";

export const links = () => [{ rel: "stylesheet", href: labelStyles }];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const shop = await requireShop(request);
  const po = await getPurchaseOrder(shop.shop, params.id || "");
  if (!po) {
    throw new Response("Purchase order not found", { status: 404 });
  }
  return {
    po: {
      id: po.id,
      number: po.number,
      supplierName: po.supplierName,
      receivedAt: po.receipts[0]?.receivedAt ?? po.updatedAt,
      lines: po.lines
        .filter((line) => line.quantityReceived > 0)
        .map((line) => ({
          id: line.id,
          sku: line.sku,
          title: line.title,
          barcode: line.barcode || line.sku,
          quantityReceived: line.quantityReceived,
          unitCost: line.lockedUnitCost || line.unitCost,
        })),
    },
  };
};

export default function LabelSheet() {
  const { po } = useLoaderData<typeof loader>();
  const [copies, setCopies] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      po.lines.map((line) => [line.id, String(line.quantityReceived)]),
    ),
  );

  const labels = useMemo(
    () =>
      po.lines.flatMap((line) => {
        const count = Math.max(0, Number.parseInt(copies[line.id] || "0", 10) || 0);
        return Array.from({ length: count }, (_, index) => ({
          key: `${line.id}-${index}`,
          sku: line.sku,
          title: line.title,
          barcode: line.barcode,
          unitCost: line.unitCost,
        }));
      }),
    [copies, po.lines],
  );

  useEffect(() => {
    const nodes = document.querySelectorAll<SVGSVGElement>("svg[data-barcode]");
    nodes.forEach((node) => {
      const value = node.dataset.barcode || "";
      if (!value) return;
      try {
        JsBarcode(node, value, {
          format: "CODE128",
          width: 1.4,
          height: 36,
          margin: 0,
          displayValue: true,
          fontSize: 10,
          textMargin: 2,
        });
      } catch {
        node.replaceChildren();
      }
    });
  }, [labels]);

  return (
    <s-page heading={`Labels · ${po.number}`}>
      <s-button slot="primary-action" onClick={() => window.print()}>
        Print sheet
      </s-button>
      <s-button slot="secondary-actions" href={`/app/receive/${po.id}`}>
        Back to receive
      </s-button>

      {po.lines.length === 0 ? (
        <s-section heading="Nothing received yet">
          <s-paragraph>
            Take a receive first. Labels print from received quantities, not the
            original ordered qty.
          </s-paragraph>
        </s-section>
      ) : (
        <div className="sheet">
          <div className="sheet-toolbar no-print">
            <div>
              <s-heading>Letter sheet · 3-up CODE128</s-heading>
              <s-paragraph>
                {po.supplierName} · received {formatDate(po.receivedAt)}. Set
                copies per SKU, then print. Use browser print to PDF if you need
                a file.
              </s-paragraph>
            </div>
          </div>

          <div className="no-print">
            <div className="rk-table-wrap">
              <table className="rk-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Received</th>
                    <th className="num">Copies</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <strong>{line.title}</strong>
                        <div className="rk-muted">{line.sku}</div>
                      </td>
                      <td>{line.quantityReceived}</td>
                      <td className="num">
                        <input
                          className="rk-input"
                          type="number"
                          min={0}
                          max={500}
                          value={copies[line.id]}
                          onChange={(event) =>
                            setCopies((current) => ({
                              ...current,
                              [line.id]: event.target.value,
                            }))
                          }
                          aria-label={`Label copies for ${line.sku}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {labels.length === 0 ? (
            <s-banner tone="warning" heading="No labels">
              Set copies above to preview the sheet.
            </s-banner>
          ) : (
            <div className="labels">
              {labels.map((label) => (
                <article className="label" key={label.key}>
                  <h2>{label.title}</h2>
                  <p className="meta">
                    {po.number} · {formatMoney(label.unitCost)}
                  </p>
                  <svg data-barcode={label.barcode} role="img" aria-label={label.barcode} />
                  <p className="meta">{label.sku}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
