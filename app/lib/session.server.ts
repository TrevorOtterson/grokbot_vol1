import { authenticate } from "../shopify.server";
import { DEMO_SHOP } from "./constants";
import { billingIsTest, isDemoMode } from "./demo.server";
import { ensureDemoSeed } from "./seed.server";
import type { ShopifyAdmin } from "./shopify-ops.server";

type BillingApi = {
  check: (options: {
    plans: string[];
    isTest?: boolean;
  }) => Promise<{ appSubscriptions: Array<{ name?: string }> }>;
  request: (options: {
    plan: string;
    isTest?: boolean;
    returnUrl?: string;
  }) => Promise<never>;
};

export type ShopContext = {
  shop: string;
  demo: boolean;
  apiKey: string;
  embedded: boolean;
  admin: ShopifyAdmin | null;
  billing: BillingApi | null;
  session: { shop: string; accessToken?: string } | null;
  billingTest: boolean;
};

export async function requireShop(request: Request): Promise<ShopContext> {
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const billingTest = billingIsTest();

  if (isDemoMode()) {
    await ensureDemoSeed(DEMO_SHOP);
    return {
      shop: DEMO_SHOP,
      demo: true,
      apiKey,
      embedded: false,
      admin: null,
      billing: null,
      session: null,
      billingTest,
    };
  }

  const { admin, billing, session } = await authenticate.admin(request);
  return {
    shop: session.shop,
    demo: false,
    apiKey,
    embedded: true,
    admin,
    billing: billing as unknown as BillingApi,
    session,
    billingTest,
  };
}
