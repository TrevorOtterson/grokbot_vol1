import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SAMPLE_OPEN_PO_NUMBER } from "../lib/constants";
import { requireShop } from "../lib/session.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireShop(request);
  return null;
};

export default function FirstReceiveHelp() {
  return (
    <s-page heading="How to get your first receive">
      <s-link slot="breadcrumb-actions" href="/app">
        Purchase orders
      </s-link>

      <s-section heading="Three steps">
        <s-paragraph>
          You do not need a support call. Get one receipt with locked unit cost,
          then print labels.
        </s-paragraph>
        <ol className="rk-steps">
          <li>
            On an empty dock, sync Shopify transfers or seed three sample POs.
          </li>
          <li>
            Open <strong>Receive</strong> on an open or partial PO, enter accept
            quantities (or Fill remaining), confirm unit cost, and submit
            Receive and lock cost.
          </li>
          <li>
            Open <strong>Labels</strong> once quantity received is greater than
            zero. Browser Print → Save as PDF or send to a label printer.
          </li>
        </ol>
      </s-section>

      <s-section heading="Sync or seed?">
        <s-unordered-list>
          <s-list-item>
            <strong>Sync Shopify transfers</strong> imports inbound inventory
            transfers as receive documents. Use this on a live shop that already
            moves stock between locations.
          </s-list-item>
          <s-list-item>
            <strong>Seed sample receives</strong> loads three practice POs
            (open / partial / complete) for this shop only. Use this on Partner
            and development stores with nothing inbound yet. Start with{" "}
            {SAMPLE_OPEN_PO_NUMBER}.
          </s-list-item>
          <s-list-item>
            If the list stays empty after sync, you likely have no open inbound
            transfers. Seed for practice, or create a Shopify inventory
            transfer, then sync again.
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Short FAQ">
        <s-box paddingBlock="small">
          <s-heading>Can I receive a partial PO?</s-heading>
          <s-paragraph>
            Yes. Remaining quantity stays open until ordered equals received.
          </s-paragraph>
        </s-box>
        <s-box paddingBlock="small">
          <s-heading>Does cost write to Shopify?</s-heading>
          <s-paragraph>
            ReceiveKit always locks unit cost on the receipt. It writes{" "}
            <code>InventoryItem.cost</code> as a PO-weighted average when the
            line has an InventoryItem GID. Sample seed lines do not. Last write
            wins — there is no shop-wide moving-average ledger.
          </s-paragraph>
        </s-box>
        <s-box paddingBlock="small">
          <s-heading>Is this a WMS?</s-heading>
          <s-paragraph>
            No. Forecasting, bins, picking, reorder, and a native PO suite are
            out of scope. Receive, labels, and cost at receipt are the product.
          </s-paragraph>
        </s-box>
        <s-paragraph>
          <Link to="/app">Back to purchase orders →</Link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
