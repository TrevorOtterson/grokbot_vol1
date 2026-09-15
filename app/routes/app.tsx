import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { requireShop } from "../lib/session.server";
import "../styles/app.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await requireShop(request);
  return {
    apiKey: shop.apiKey,
    demo: shop.demo,
    embedded: shop.embedded,
    shopDomain: shop.shop,
  };
};

export default function App() {
  const { apiKey, demo, embedded, shopDomain } = useLoaderData<typeof loader>();

  const chrome = (
    <>
      <s-app-nav>
        <s-link href="/app">Purchase orders</s-link>
        <s-link href="/app/billing">Billing</s-link>
      </s-app-nav>
      {demo ? (
        <s-box padding="base">
          <s-banner heading="Demo mode" tone="info">
            Running as {shopDomain} without a connected Shopify admin. Receives
            lock cost in ReceiveKit only. Use <code>shopify app dev</code> to
            install on a test store.
          </s-banner>
        </s-box>
      ) : null}
      <Outlet />
    </>
  );

  if (embedded) {
    return (
      <AppProvider embedded apiKey={apiKey}>
        {chrome}
      </AppProvider>
    );
  }

  return <AppProvider embedded={false}>{chrome}</AppProvider>;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
