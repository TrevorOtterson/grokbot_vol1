import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  // Honest: ReceiveKit does not persist storefront customer profiles.
  // Merchant staff fields on Session are OAuth, not shopper PII.
  // Acknowledge quickly; do not log the payload (it can include email/phone).
  console.log(`[gdpr] ${topic} for ${shop}: no customer PII stored; acknowledged`);

  return new Response();
};
