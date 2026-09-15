import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useLoaderData } from "react-router";
import { isDemoMode } from "../../lib/demo.server";
import { login } from "../../shopify.server";
import "../../styles/landing.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return {
    demo: isDemoMode(),
    showForm: Boolean(login) && !isDemoMode(),
  };
};

export default function Landing() {
  const { demo, showForm } = useLoaderData<typeof loader>();

  return (
    <div className="landing">
      <main className="hero">
        <p className="kicker">After Stocky · Shopify admin app</p>
        <h1>Receive the PO. Print the labels. Lock the cost.</h1>
        <p className="lede">
          ReceiveKit is a small embedded Shopify app for the dock: partial
          receives, barcode sheets, and unit cost frozen on the receipt. It is
          not a WMS, forecast engine, or reorder tool.
        </p>
        <div className="cta-row">
          <Link className="btn btn-primary" to="/app">
            {demo ? "Open demo dock" : "Open app"}
          </Link>
          <a className="btn btn-secondary" href="#setup">
            Partner store setup
          </a>
        </div>
        <div className="grid">
          <article className="card">
            <h2>1. Open receive</h2>
            <p>Work from a PO list. Accept some or all remaining units.</p>
          </article>
          <article className="card">
            <h2>2. Print labels</h2>
            <p>Letter-size 3-up sheet with CODE128 from SKU or barcode.</p>
          </article>
          <article className="card">
            <h2>3. Lock cost</h2>
            <p>
              Snapshot unit cost on the receipt. Write InventoryItem.cost when
              the Admin API allows.
            </p>
          </article>
        </div>
        <p className="out" id="setup">
          Out of scope: forecasting, full WMS, transfers suite, B2B portal,
          reorder, catalogs, net terms, AI.
        </p>
        {showForm ? (
          <Form className="shop-form" method="post" action="/auth/login">
            <label>
              Shop domain
              <input type="text" name="shop" placeholder="your-store.myshopify.com" />
            </label>
            <button className="btn btn-primary" type="submit">
              Log in with Shopify
            </button>
          </Form>
        ) : null}
      </main>
    </div>
  );
}
