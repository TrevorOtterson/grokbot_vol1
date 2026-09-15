import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { listPurchaseOrders } from "../lib/po.server";
import { remainingQuantity } from "../lib/receive";
import { requireShop } from "../lib/session.server";
import { getShopState, syncFromShopify } from "../lib/sync.server";
import { formatDate, StatusBadge } from "../lib/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await requireShop(request);
  const [orders, state] = await Promise.all([
    listPurchaseOrders(shop.shop),
    getShopState(shop.shop),
  ]);

  return {
    demo: shop.demo,
    shopDomain: shop.shop,
    lastSyncNote: state.lastSyncNote,
    lastSyncAt: state.lastSyncAt,
    plan: state.plan,
    orders: orders.map((order) => {
      const ordered = order.lines.reduce((sum, line) => sum + line.quantityOrdered, 0);
      const received = order.lines.reduce((sum, line) => sum + line.quantityReceived, 0);
      const remaining = order.lines.reduce(
        (sum, line) => sum + remainingQuantity(line),
        0,
      );
      return {
        id: order.id,
        number: order.number,
        supplierName: order.supplierName,
        destinationName: order.destinationName,
        expectedOn: order.expectedOn,
        status: order.status,
        source: order.source,
        ordered,
        received,
        remaining,
        lineCount: order.lines.length,
      };
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = await requireShop(request);
  if (shop.demo || !shop.admin) {
    return {
      ok: false,
      message: "Connect a Shopify store with shopify app dev to sync transfers.",
    };
  }

  const result = await syncFromShopify({
    shop: shop.shop,
    admin: shop.admin,
    accessToken: shop.session?.accessToken,
  });
  return { ok: true, message: result.lastSyncNote };
};

export default function PurchaseOrderList() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const syncing = navigation.state !== "idle" && navigation.formData?.get("intent") === "sync";
  const openCount = data.orders.filter((order) => order.status !== "received").length;

  return (
    <s-page heading="Purchase orders">
      <s-button
        slot="primary-action"
        href={data.orders.find((order) => order.remaining > 0)?.id
          ? `/app/receive/${data.orders.find((order) => order.remaining > 0)?.id}`
          : undefined}
        {...(data.orders.some((order) => order.remaining > 0) ? {} : { disabled: true })}
      >
        Open next receive
      </s-button>

      <s-section heading="Dock queue">
        <s-paragraph>
          ReceiveKit covers the Stocky-shaped gap after sunset: open a PO, take a
          partial or full receive, print barcode labels, and lock unit cost on
          that receipt. Forecasting, transfers suites, and reorder are out of
          scope.
        </s-paragraph>
        {actionData?.message ? (
          <s-banner
            heading={actionData.ok ? "Shopify sync" : "Sync skipped"}
            tone={actionData.ok ? "success" : "warning"}
          >
            {actionData.message}
          </s-banner>
        ) : null}
        {data.lastSyncNote && !actionData ? (
          <s-box paddingBlock="small">
            <s-text color="subdued">{data.lastSyncNote}</s-text>
          </s-box>
        ) : null}
        <s-stack direction="inline" gap="base">
          <Form method="post">
            <input type="hidden" name="intent" value="sync" />
            <s-button type="submit" {...(syncing ? { loading: true } : {})} disabled={data.demo}>
              Sync Shopify transfers
            </s-button>
          </Form>
          <s-button href="/app/billing" variant="tertiary">
            Plan: {data.plan === "none" ? "none selected" : data.plan}
          </s-button>
        </s-stack>
      </s-section>

      {data.orders.length === 0 ? (
        <s-section heading="No purchase orders">
          <s-box padding="large" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack gap="base">
              <s-heading>Nothing on the dock</s-heading>
              <s-paragraph>
                Demo seed should create three POs. If you are on a live shop,
                create app-owned POs later or sync inbound inventory transfers.
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-section>
      ) : (
        <s-section heading={`${openCount} still open · ${data.orders.length} total`}>
          <div className="rk-table-wrap">
            <table className="rk-table">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Supplier</th>
                  <th>Destination</th>
                  <th>Expected</th>
                  <th>Status</th>
                  <th className="num">Received</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => {
                  const pct =
                    order.ordered === 0
                      ? 0
                      : Math.round((order.received / order.ordered) * 100);
                  return (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.number}</strong>
                        <div className="rk-muted">
                          {order.lineCount} lines
                          {order.source === "shopify_transfer" ? " · transfer" : ""}
                        </div>
                      </td>
                      <td>{order.supplierName}</td>
                      <td>{order.destinationName}</td>
                      <td>{formatDate(order.expectedOn)}</td>
                      <td>
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="num">
                        {order.received}/{order.ordered}
                        <div className="rk-progress" aria-hidden="true">
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td>
                        <s-stack direction="inline" gap="small">
                          <s-button
                            href={`/app/receive/${order.id}`}
                            variant={order.remaining > 0 ? "primary" : "secondary"}
                          >
                            {order.remaining > 0 ? "Receive" : "View"}
                          </s-button>
                          <s-button
                            href={`/app/labels/${order.id}`}
                            variant="tertiary"
                            disabled={order.received === 0}
                          >
                            Labels
                          </s-button>
                        </s-stack>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </s-section>
      )}

      <s-section slot="aside" heading="This MVP">
        <s-unordered-list>
          <s-list-item>PO list and open receive</s-list-item>
          <s-list-item>Partial quantities</s-list-item>
          <s-list-item>Printable CODE128 label sheet</s-list-item>
          <s-list-item>Unit cost locked on the receipt</s-list-item>
        </s-unordered-list>
      </s-section>
      <s-section slot="aside" heading="Not in this app">
        <s-paragraph>
          Forecasting, full WMS, transfers suite, B2B portal, reorder,
          catalogs, net terms, and AI features.
        </s-paragraph>
        <s-paragraph>
          <Link to="/">How to connect a Partner store →</Link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
