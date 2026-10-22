import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BILLING_PLAN_CONFIG, resetBillingState } from "./lib/billing.server";
import { DOCK_PLAN, FLOOR_PLAN, YARD_PLAN } from "./lib/constants";

export const apiSecretKey = process.env.SHOPIFY_API_SECRET || "demo-secret";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "00000000000000000000000000000000",
  apiSecretKey,
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "http://127.0.0.1:43173",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: BILLING_PLAN_CONFIG,
  hooks: {
    afterAuth: async ({ session }) => {
      // Reinstall gets a new OAuth even when an old ShopState row says active.
      // Shopify cancelled the subscription on uninstall, so local state must not
      // skip a new approval. The billing page re-reads Shopify after this.
      try {
        await resetBillingState(session.shop);
      } catch (error) {
        console.error(`[billing] could not reset billing state for ${session.shop}`, error);
      }
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
export { DOCK_PLAN, FLOOR_PLAN, YARD_PLAN };
