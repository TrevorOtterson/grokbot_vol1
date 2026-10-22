import type { ActionFunctionArgs } from "react-router";
import {
  authenticUninstallShop,
  clearShopInstallState,
} from "../lib/billing.server";
import { apiSecretKey, authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Drop sessions before authenticate.webhook loads them. With expiring
  // offline tokens, that load refreshes the token; after uninstall the refresh
  // fails and the handler never runs, leaving a revoked session that blocks
  // a new charge on reinstall. HMAC is checked here and again below.
  const earlyShop = await authenticUninstallShop(request.clone(), apiSecretKey);
  if (earlyShop) {
    await clearShopInstallState(earlyShop);
  }

  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  await clearShopInstallState(shop);

  return new Response();
};
