import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  // Honest: no storefront customer records to delete. Session.email is the
  // merchant staff OAuth user, not a shopper. Acknowledge quickly.
  console.log(`[gdpr] ${topic} for ${shop}: no customer PII to redact; acknowledged`);

  return new Response();
};
