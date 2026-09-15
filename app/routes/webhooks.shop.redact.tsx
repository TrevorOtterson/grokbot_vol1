import type { ActionFunctionArgs } from "react-router";
import { redactShopData } from "../lib/gdpr.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  // 48h after uninstall: erase shop-scoped receive data, sessions, and state.
  await redactShopData(shop);
  console.log(`[gdpr] ${topic} for ${shop}: shop data deleted`);

  return new Response();
};
