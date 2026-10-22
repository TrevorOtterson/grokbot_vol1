import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingConfigSubscriptionLineItemPlan } from "@shopify/shopify-api";
import {
  BillingInterval,
  BillingReplacementBehavior,
} from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  DOCK_PLAN,
  FLOOR_PLAN,
  PLANS,
  TRIAL_DAYS,
  YARD_PLAN,
  type PlanKey,
} from "./constants";

const PLAN_NAMES = [DOCK_PLAN, FLOOR_PLAN, YARD_PLAN];

const SHOP_DOMAIN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
const ADMIN_HOST = /^admin\.shopify\.com\/store\/([A-Za-z0-9][A-Za-z0-9-]*)$/;
const LEGACY_HOST = /^([A-Za-z0-9][A-Za-z0-9-]*)\.myshopify\.com\/admin$/;
const DEV_PLAN_NAME =
  /\b(development|developer preview|staff|affiliate|sandbox)\b/i;
const TEST_CHARGE_ERROR =
  /test charges?|test mode|set test|test to true|non-test|must be a test/i;
const DEV_STORE_ERROR = /development store|partner development|staff store/i;

const SHOP_PLAN_QUERY = `#graphql
  query ReceiveKitShopPlan {
    shop {
      plan {
        partnerDevelopment
        publicDisplayName
      }
    }
  }
`;

export const BILLING_PLAN_CONFIG = {
  [DOCK_PLAN]: recurringPlan(49),
  [FLOOR_PLAN]: recurringPlan(79),
  [YARD_PLAN]: recurringPlan(99),
};

function recurringPlan(amount: number): BillingConfigSubscriptionLineItemPlan {
  return {
    trialDays: TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    lineItems: [
      {
        amount,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
  };
}

export type ShopPlanInfo = {
  partnerDevelopment?: boolean | null;
  publicDisplayName?: string | null;
};

export type BillingCheckResult = {
  hasActivePayment?: boolean;
  appSubscriptions?: Array<{ name?: string | null }>;
};

export type BillingGateway = {
  check: (options: {
    plans: string[];
    isTest?: boolean;
  }) => Promise<BillingCheckResult>;
  request: (options: {
    plan: string;
    isTest?: boolean;
    trialDays?: number;
    returnUrl?: string;
  }) => Promise<never>;
};

export type BillingOutcome = "accepted" | "declined" | "active" | "inactive";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export class BillingRequestFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingRequestFailed";
  }
}

type PlanDecision =
  | { type: "invalid"; message: string }
  | { type: "demo"; plan: PlanKey; message: string }
  | { type: "already-active"; plan: PlanKey; message: string }
  | { type: "request"; plan: PlanKey; planName: string; isTest: boolean };

/**
 * Development stores (including App Store review) reject live charges.
 * BILLING_TEST_MODE=false still means live charges for real merchants.
 */
export function shopRequiresTestCharge(plan: ShopPlanInfo | null | undefined) {
  if (!plan) return false;
  if (plan.partnerDevelopment) return true;
  return DEV_PLAN_NAME.test(plan.publicDisplayName || "");
}

export function resolveBillingTest(input: {
  envForcesTest: boolean;
  shopPlan: ShopPlanInfo | null;
}) {
  if (input.envForcesTest) return true;
  return shopRequiresTestCharge(input.shopPlan);
}

export function billingModeLabel(billingTest: boolean) {
  return billingTest
    ? "This store uses a Shopify test charge, so approving does not bill a card."
    : "Approving starts a live Shopify charge after the free trial.";
}

export async function fetchShopPlan(admin: AdminGraphql): Promise<ShopPlanInfo | null> {
  try {
    const response = await admin.graphql(SHOP_PLAN_QUERY);
    const json = (await response.json()) as {
      errors?: unknown;
      data?: {
        shop?: {
          plan?: {
            partnerDevelopment?: boolean | null;
            publicDisplayName?: string | null;
          } | null;
        } | null;
      };
    };
    if (json.errors || !json.data?.shop?.plan) return null;
    return {
      partnerDevelopment: Boolean(json.data.shop.plan.partnerDevelopment),
      publicDisplayName: json.data.shop.plan.publicDisplayName ?? null,
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    return null;
  }
}

/**
 * After approve or decline, Shopify navigates the top window to returnUrl.
 * That URL has to be the embedded admin app page. A bare app origin has no
 * shop/host, so authenticate.admin renders an empty App Bridge document.
 */
export function billingReturnUrl(input: {
  shop: string;
  apiKey: string;
  host?: string | null;
}) {
  if (!/^[A-Za-z0-9]+$/.test(input.apiKey)) return null;
  const fromHost = returnUrlFromHost(input.host, input.apiKey);
  if (fromHost) return fromHost;
  const handle = shopHandle(input.shop);
  if (!handle) return null;
  return `https://admin.shopify.com/store/${handle}/apps/${input.apiKey}/app/billing`;
}

export function describeBilling(input: {
  hasActivePayment: boolean;
  subscriptionName: string | null;
  chargeId: string | null;
  localBillingStatus: string;
}): {
  outcome: BillingOutcome;
  shopifyPlan: string | null;
  planKey: PlanKey | null;
} {
  if (input.hasActivePayment) {
    const returned =
      Boolean(input.chargeId?.trim()) || input.localBillingStatus === "pending";
    return {
      outcome: returned ? "accepted" : "active",
      shopifyPlan: input.subscriptionName,
      planKey: planKeyFromName(input.subscriptionName),
    };
  }

  const returnedFromCharge =
    Boolean(input.chargeId?.trim()) || input.localBillingStatus === "pending";
  return {
    outcome: returnedFromCharge ? "declined" : "inactive",
    shopifyPlan: null,
    planKey: null,
  };
}

export function decidePlanRequest(input: {
  planKey: string;
  demo: boolean;
  activeSubscriptionName: string | null;
  envForcesTest: boolean;
  shopPlan: ShopPlanInfo | null;
}): PlanDecision {
  const plan = PLANS.find((item) => item.key === input.planKey);
  if (!plan) {
    return { type: "invalid", message: "Choose Dock, Floor, or Yard." };
  }

  if (input.demo) {
    return {
      type: "demo",
      plan: plan.key,
      message: `Demo: ${plan.name} selected at $${plan.price}/30 days after a ${TRIAL_DAYS}-day free trial. Shopify App Billing is not charged in demo mode.`,
    };
  }

  if (input.activeSubscriptionName === plan.name) {
    return {
      type: "already-active",
      plan: plan.key,
      message: `${plan.name} is already active. No new charge was requested.`,
    };
  }

  return {
    type: "request",
    plan: plan.key,
    planName: plan.name,
    isTest: resolveBillingTest({
      envForcesTest: input.envForcesTest,
      shopPlan: input.shopPlan,
    }),
  };
}

/**
 * billing.request throws a Response that breaks the embedded iframe out to
 * Shopify's confirmation URL. Callers must rethrow that Response. Any other
 * failure becomes a banner so the merchant can request approval again.
 */
export async function beginPlanRequest(input: {
  gateway: BillingGateway;
  planName: string;
  isTest: boolean;
  returnUrl: string;
}): Promise<never> {
  const attempt = (isTest: boolean) =>
    input.gateway.request({
      plan: input.planName,
      isTest,
      trialDays: TRIAL_DAYS,
      returnUrl: input.returnUrl,
    });

  try {
    await attempt(input.isTest);
  } catch (error) {
    if (error instanceof Response) throw error;
    if (!input.isTest && errorRequiresTestCharge(error)) {
      try {
        await attempt(true);
      } catch (retryError) {
        if (retryError instanceof Response) throw retryError;
        throw new BillingRequestFailed(billingFailureMessage(retryError));
      }
    } else {
      throw new BillingRequestFailed(billingFailureMessage(error));
    }
  }

  throw new BillingRequestFailed(
    "Shopify did not open the charge approval page. Choose a plan to request approval again.",
  );
}

export async function readSubscription(
  gateway: BillingGateway,
  billingTest: boolean,
): Promise<{
  hasActivePayment: boolean;
  subscriptionName: string | null;
  billingTest: boolean;
}> {
  try {
    const primary = await gateway.check({ plans: PLAN_NAMES, isTest: billingTest });
    if (subscriptionActive(primary) || billingTest) {
      return {
        hasActivePayment: subscriptionActive(primary),
        subscriptionName: subscriptionActive(primary) ? subscriptionName(primary) : null,
        billingTest,
      };
    }

    const testSubscription = await gateway.check({ plans: PLAN_NAMES, isTest: true });
    if (subscriptionActive(testSubscription)) {
      return {
        hasActivePayment: true,
        subscriptionName: subscriptionName(testSubscription),
        billingTest: true,
      };
    }

    return { hasActivePayment: false, subscriptionName: null, billingTest };
  } catch (error) {
    if (error instanceof Response) throw error;
    return { hasActivePayment: false, subscriptionName: null, billingTest };
  }
}

export function errorRequiresTestCharge(error: unknown) {
  const text = billingFailureText(error);
  if (TEST_CHARGE_ERROR.test(text)) return true;
  if (DEV_STORE_ERROR.test(text) && /\btests?\b/i.test(text)) return true;
  return (
    /\btest\b/i.test(text) &&
    /development store|partner development|not allowed|cannot|can't|must/i.test(text)
  );
}

export function billingFailureMessage(error: unknown) {
  const detail = billingFailureText(error).replace(/\s+/g, " ").trim();
  const clipped = detail.length > 240 ? `${detail.slice(0, 237)}...` : detail;
  if (!clipped) {
    return "Shopify could not start the charge. Choose a plan to request approval again.";
  }
  return `Shopify could not start the charge: ${clipped}. Choose a plan to request approval again.`;
}

export async function saveBillingState(
  shop: string,
  plan: string,
  billingStatus: string,
) {
  await prisma.shopState.upsert({
    where: { shop },
    update: { plan, billingStatus },
    create: { shop, plan, billingStatus },
  });
}

/** New OAuth (install or reinstall). Does not delete the session just stored. */
export async function resetBillingState(shop: string) {
  await prisma.shopState.updateMany({
    where: { shop },
    data: { plan: "none", billingStatus: "inactive" },
  });
}

/**
 * app/uninstalled: drop every session and the local plan flag. Shopify cancels
 * the subscription. A later install must request approval again. Purchase
 * orders stay until shop/redact.
 */
export async function clearShopInstallState(shop: string) {
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { shop } }),
    prisma.shopState.updateMany({
      where: { shop },
      data: { plan: "none", billingStatus: "inactive" },
    }),
  ]);
}

/**
 * HMAC of the raw body, same check authenticate.webhook performs. Returns the
 * shop only when the header shop matches the signed payload, so cleanup can
 * run before the library tries to refresh an uninstalled expiring token.
 */
export async function authenticUninstallShop(request: Request, secret: string) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const shopHeader = request.headers.get("x-shopify-shop-domain");
  if (!hmac || !secret || !webhookHmacMatches(rawBody, hmac, secret)) return null;
  return shopFromUninstallPayload(rawBody, shopHeader);
}

export function webhookHmacMatches(rawBody: string, hmacHeader: string, secret: string) {
  if (!rawBody || !hmacHeader || !secret) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const actual = Buffer.from(digest);
  const expected = Buffer.from(hmacHeader);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function shopFromUninstallPayload(rawBody: string, shopHeader: string | null) {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { myshopify_domain?: unknown; domain?: unknown };
  const fromBody =
    typeof record.myshopify_domain === "string"
      ? record.myshopify_domain
      : typeof record.domain === "string"
        ? record.domain
        : null;
  if (!fromBody || !SHOP_DOMAIN.test(fromBody)) return null;
  if (!shopHeader || shopHeader !== fromBody) return null;
  return fromBody;
}

export function planKeyFromName(name: string | null | undefined): PlanKey | null {
  const match = PLANS.find((plan) => plan.name === name);
  return match?.key ?? null;
}

function shopHandle(shop: string) {
  const match = shop
    .trim()
    .toLowerCase()
    .match(/^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/);
  return match?.[1] ?? null;
}

function returnUrlFromHost(host: string | null | undefined, apiKey: string) {
  if (!host) return null;
  const normalized = host.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[0-9a-zA-Z+/]+={0,2}$/.test(normalized)) return null;
  const decoded = Buffer.from(normalized, "base64").toString("utf8");
  if (!decoded || decoded.includes("\0") || /\s/.test(decoded)) return null;

  const admin = decoded.match(ADMIN_HOST);
  if (admin) {
    return `https://admin.shopify.com/store/${admin[1]}/apps/${apiKey}/app/billing`;
  }
  const legacy = decoded.match(LEGACY_HOST);
  if (legacy) {
    return `https://${legacy[1]}.myshopify.com/admin/apps/${apiKey}/app/billing`;
  }
  return null;
}

function subscriptionActive(result: BillingCheckResult) {
  if (typeof result.hasActivePayment === "boolean") return result.hasActivePayment;
  return (result.appSubscriptions?.length ?? 0) > 0;
}

function subscriptionName(result: BillingCheckResult) {
  const name = result.appSubscriptions?.[0]?.name;
  return name ? String(name) : null;
}

function billingFailureText(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const record = error as { message?: unknown; errorData?: unknown };
  const parts: string[] = [];
  if (typeof record.message === "string") parts.push(record.message);
  if (Array.isArray(record.errorData)) {
    for (const item of record.errorData) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (item && typeof item === "object") {
        const entry = item as { message?: unknown; field?: unknown };
        if (typeof entry.message === "string") parts.push(entry.message);
        if (typeof entry.field === "string") parts.push(entry.field);
        if (Array.isArray(entry.field)) parts.push(entry.field.join(" "));
      }
    }
  }
  return parts.join(" ");
}
