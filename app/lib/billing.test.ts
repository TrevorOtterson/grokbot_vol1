import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { after } from "node:test";
import {
  BillingInterval,
  BillingReplacementBehavior,
} from "@shopify/shopify-app-react-router/server";
import {
  BILLING_PLAN_CONFIG,
  BillingRequestFailed,
  authenticUninstallShop,
  beginPlanRequest,
  billingReturnUrl,
  clearShopInstallState,
  decidePlanRequest,
  describeBilling,
  errorRequiresTestCharge,
  readSubscription,
  resetBillingState,
  resolveBillingTest,
  type BillingGateway,
} from "./billing.server";
import { DOCK_PLAN, FLOOR_PLAN, TRIAL_DAYS, YARD_PLAN } from "./constants";
import prisma from "../db.server";

const API_KEY = "36a0a9aa745cf78c3a96d05f42bc043e";
const SHOP = "receivekit-dev.myshopify.com";
const CONFIRMATION =
  "https://admin.shopify.com/store/receivekit-dev/charges/1/confirm";
const RETURN_URL = `https://admin.shopify.com/store/receivekit-dev/apps/${API_KEY}/app/billing`;
const DEV_PLAN = { partnerDevelopment: true, publicDisplayName: "Development" };
const LIVE_PLAN = { partnerDevelopment: false, publicDisplayName: "Basic" };

test("plan config keeps the 14-day trial and replaces an old subscription immediately", () => {
  assert.equal(TRIAL_DAYS, 14);
  for (const name of [DOCK_PLAN, FLOOR_PLAN, YARD_PLAN] as const) {
    const plan = BILLING_PLAN_CONFIG[name];
    assert.equal(plan.trialDays, 14);
    assert.equal(plan.replacementBehavior, BillingReplacementBehavior.ApplyImmediately);
    assert.equal(plan.lineItems[0]?.interval, BillingInterval.Every30Days);
    assert.equal(plan.lineItems[0]?.currencyCode, "USD");
  }
  assert.equal(BILLING_PLAN_CONFIG[DOCK_PLAN].lineItems[0]?.amount, 49);
  assert.equal(BILLING_PLAN_CONFIG[FLOOR_PLAN].lineItems[0]?.amount, 79);
  assert.equal(BILLING_PLAN_CONFIG[YARD_PLAN].lineItems[0]?.amount, 99);
});

test("return URL is the embedded admin billing page, not the bare app origin", () => {
  assert.equal(
    billingReturnUrl({ shop: SHOP, apiKey: API_KEY }),
    RETURN_URL,
  );

  const host = Buffer.from("admin.shopify.com/store/receivekit-dev").toString("base64");
  assert.equal(billingReturnUrl({ shop: SHOP, apiKey: API_KEY, host }), RETURN_URL);

  const legacy = Buffer.from("receivekit-dev.myshopify.com/admin").toString("base64");
  assert.equal(
    billingReturnUrl({ shop: SHOP, apiKey: API_KEY, host: legacy }),
    `https://receivekit-dev.myshopify.com/admin/apps/${API_KEY}/app/billing`,
  );

  const evil = Buffer.from("https://evil.example/phish").toString("base64");
  assert.equal(billingReturnUrl({ shop: SHOP, apiKey: API_KEY, host: evil }), RETURN_URL);

  const traversal = Buffer.from("admin.shopify.com/store/foo/../../evil").toString("base64");
  assert.equal(
    billingReturnUrl({ shop: SHOP, apiKey: API_KEY, host: traversal }),
    RETURN_URL,
  );

  assert.equal(billingReturnUrl({ shop: "not a shop", apiKey: API_KEY }), null);
  assert.equal(billingReturnUrl({ shop: SHOP, apiKey: "../admin" }), null);
});

test("development stores use test charges even when live billing is enabled", () => {
  assert.equal(resolveBillingTest({ envForcesTest: false, shopPlan: DEV_PLAN }), true);
  assert.equal(
    resolveBillingTest({
      envForcesTest: false,
      shopPlan: { partnerDevelopment: false, publicDisplayName: "Staff" },
    }),
    true,
  );
  assert.equal(resolveBillingTest({ envForcesTest: false, shopPlan: LIVE_PLAN }), false);
  assert.equal(resolveBillingTest({ envForcesTest: true, shopPlan: LIVE_PLAN }), true);
  assert.equal(resolveBillingTest({ envForcesTest: false, shopPlan: null }), false);
});

test("accepting a charge redirects to the Shopify confirmation URL", async () => {
  const billing = fakeBilling();
  await assert.rejects(
    () =>
      beginPlanRequest({
        gateway: billing.gateway,
        planName: DOCK_PLAN,
        isTest: true,
        returnUrl: RETURN_URL,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Response);
      assert.equal(error.status, 401);
      assert.equal(
        error.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url"),
        CONFIRMATION,
      );
      return true;
    },
  );
  assert.equal(billing.requests.length, 1);
  assert.deepEqual(billing.requests[0], {
    plan: DOCK_PLAN,
    isTest: true,
    trialDays: 14,
    returnUrl: RETURN_URL,
  });
});

test("a fresh install can accept Dock on a development store while live mode is on", () => {
  const decision = decidePlanRequest({
    planKey: "dock",
    demo: false,
    activeSubscriptionName: null,
    envForcesTest: false,
    shopPlan: DEV_PLAN,
  });
  assert.equal(decision.type, "request");
  if (decision.type !== "request") return;
  assert.equal(decision.isTest, true);
  assert.equal(decision.planName, DOCK_PLAN);
});

test("a live merchant is offered a live charge", () => {
  const decision = decidePlanRequest({
    planKey: "floor",
    demo: false,
    activeSubscriptionName: null,
    envForcesTest: false,
    shopPlan: LIVE_PLAN,
  });
  assert.equal(decision.type, "request");
  if (decision.type !== "request") return;
  assert.equal(decision.isTest, false);
  assert.equal(decision.planName, FLOOR_PLAN);
});

test("declining a charge stays on billing and can request approval again", async () => {
  const declined = describeBilling({
    hasActivePayment: false,
    subscriptionName: null,
    chargeId: "987654321",
    localBillingStatus: "pending",
  });
  assert.equal(declined.outcome, "declined");
  assert.equal(declined.shopifyPlan, null);

  const abandoned = describeBilling({
    hasActivePayment: false,
    subscriptionName: null,
    chargeId: null,
    localBillingStatus: "pending",
  });
  assert.equal(abandoned.outcome, "declined");

  const decision = decidePlanRequest({
    planKey: "dock",
    demo: false,
    activeSubscriptionName: null,
    envForcesTest: false,
    shopPlan: DEV_PLAN,
  });
  assert.equal(decision.type, "request");

  const billing = fakeBilling();
  await assert.rejects(() =>
    beginPlanRequest({
      gateway: billing.gateway,
      planName: DOCK_PLAN,
      isTest: true,
      returnUrl: RETURN_URL,
    }),
  );
  assert.equal(billing.requests.length, 1);
  assert.equal(billing.requests[0]?.isTest, true);
  assert.equal(billing.requests[0]?.trialDays, 14);
});

test("an approved charge is shown as active and is not requested again", async () => {
  const accepted = describeBilling({
    hasActivePayment: true,
    subscriptionName: DOCK_PLAN,
    chargeId: "987654321",
    localBillingStatus: "pending",
  });
  assert.equal(accepted.outcome, "accepted");
  assert.equal(accepted.planKey, "dock");

  const active = describeBilling({
    hasActivePayment: true,
    subscriptionName: DOCK_PLAN,
    chargeId: null,
    localBillingStatus: "active",
  });
  assert.equal(active.outcome, "active");

  const decision = decidePlanRequest({
    planKey: "dock",
    demo: false,
    activeSubscriptionName: DOCK_PLAN,
    envForcesTest: false,
    shopPlan: DEV_PLAN,
  });
  assert.equal(decision.type, "already-active");

  const billing = fakeBilling({ activeName: DOCK_PLAN });
  const seen = await readSubscription(billing.gateway, true);
  assert.equal(seen.hasActivePayment, true);
  assert.equal(seen.subscriptionName, DOCK_PLAN);
  assert.equal(billing.requests.length, 0);
});

test("switching plans while one is active still opens charge approval", () => {
  const decision = decidePlanRequest({
    planKey: "yard",
    demo: false,
    activeSubscriptionName: DOCK_PLAN,
    envForcesTest: false,
    shopPlan: LIVE_PLAN,
  });
  assert.equal(decision.type, "request");
  if (decision.type !== "request") return;
  assert.equal(decision.planName, YARD_PLAN);
  assert.equal(decision.isTest, false);
});

test("a test subscription is still visible when the first check uses live mode", async () => {
  let calls = 0;
  const gateway: BillingGateway = {
    check: async ({ isTest }) => {
      calls += 1;
      if (!isTest) return { hasActivePayment: false, appSubscriptions: [] };
      return { hasActivePayment: true, appSubscriptions: [{ name: DOCK_PLAN }] };
    },
    request: async () => {
      throw new Error("should not request");
    },
  };
  const seen = await readSubscription(gateway, false);
  assert.equal(calls, 2);
  assert.equal(seen.hasActivePayment, true);
  assert.equal(seen.subscriptionName, DOCK_PLAN);
  assert.equal(seen.billingTest, true);
});

test("a development-store live-charge error retries once as a test charge", async () => {
  const billing = fakeBilling({
    firstError: {
      message: "Error while billing the store",
      errorData: [
        {
          field: ["test"],
          message: "Development stores cannot process live charges. Set test to true.",
        },
      ],
    },
  });
  assert.equal(errorRequiresTestCharge(billing.firstError), true);
  await assert.rejects(
    () =>
      beginPlanRequest({
        gateway: billing.gateway,
        planName: DOCK_PLAN,
        isTest: false,
        returnUrl: RETURN_URL,
      }),
    (error: unknown) => error instanceof Response,
  );
  assert.deepEqual(
    billing.requests.map((request) => request.isTest),
    [false, true],
  );
});

test("other billing failures stay on the page instead of throwing an error response", async () => {
  const billing = fakeBilling({
    firstError: {
      message: "Error while billing the store",
      errorData: [{ message: "Price must be greater than zero" }],
    },
  });
  assert.equal(errorRequiresTestCharge(billing.firstError), false);
  assert.equal(errorRequiresTestCharge({ message: "latest development store sync failed" }), false);
  await assert.rejects(
    () =>
      beginPlanRequest({
        gateway: billing.gateway,
        planName: DOCK_PLAN,
        isTest: false,
        returnUrl: RETURN_URL,
      }),
    (error: unknown) => {
      assert.ok(error instanceof BillingRequestFailed);
      assert.match(error.message, /request approval again/);
      assert.equal(error instanceof Response, false);
      return true;
    },
  );
  assert.equal(billing.requests.length, 1);
});

test("reinstall clears stale sessions and billing state, then requests approval again", async () => {
  const shop = "billing-reinstall-test.myshopify.com";
  const other = "billing-reinstall-other.myshopify.com";
  try {
    await clearShopInstallState(shop);
    await clearShopInstallState(other);
    await prisma.session.create({
      data: {
        id: "billing-reinstall-session",
        shop,
        state: "stale",
        isOnline: false,
        accessToken: "revoked-after-uninstall",
      },
    });
    await prisma.session.create({
      data: {
        id: "billing-reinstall-other-session",
        shop: other,
        state: "keep",
        isOnline: false,
        accessToken: "other-token",
      },
    });
    await prisma.shopState.create({
      data: { shop, plan: "dock", billingStatus: "active" },
    });
    await prisma.purchaseOrder.create({
      data: {
        id: "po-billing-reinstall",
        shop,
        number: "PO-REINSTALL",
        supplierName: "Apex",
        destinationName: "Dock",
        status: "open",
      },
    });

    await clearShopInstallState(shop);

    assert.equal(await prisma.session.count({ where: { shop } }), 0);
    assert.equal(await prisma.session.count({ where: { shop: other } }), 1);
    const state = await prisma.shopState.findUnique({ where: { shop } });
    assert.equal(state?.billingStatus, "inactive");
    assert.equal(state?.plan, "none");
    assert.equal(await prisma.purchaseOrder.count({ where: { shop } }), 1);

    const decision = decidePlanRequest({
      planKey: "dock",
      demo: false,
      activeSubscriptionName: null,
      envForcesTest: false,
      shopPlan: DEV_PLAN,
    });
    assert.equal(decision.type, "request");

    const billing = fakeBilling();
    await assert.rejects(() =>
      beginPlanRequest({
        gateway: billing.gateway,
        planName: DOCK_PLAN,
        isTest: true,
        returnUrl: billingReturnUrl({ shop, apiKey: API_KEY }) ?? "",
      }),
    );
    assert.equal(billing.requests.length, 1);
    assert.equal(billing.requests[0]?.trialDays, 14);
    assert.match(billing.requests[0]?.returnUrl ?? "", /\/apps\/.+\/app\/billing$/);
  } finally {
    await prisma.purchaseOrder.deleteMany({ where: { shop } });
    await prisma.session.deleteMany({ where: { shop: { in: [shop, other] } } });
    await prisma.shopState.deleteMany({ where: { shop: { in: [shop, other] } } });
  }
});

test("oauth reset clears the local plan flag and keeps the new session", async () => {
  const shop = "billing-oauth-reset-test.myshopify.com";
  try {
    await prisma.session.create({
      data: {
        id: "billing-oauth-reset-session",
        shop,
        state: "new",
        isOnline: false,
        accessToken: "fresh-install-token",
      },
    });
    await prisma.shopState.create({
      data: { shop, plan: "floor", billingStatus: "active" },
    });

    await resetBillingState(shop);

    assert.equal(await prisma.session.count({ where: { shop } }), 1);
    const state = await prisma.shopState.findUnique({ where: { shop } });
    assert.equal(state?.billingStatus, "inactive");
    assert.equal(state?.plan, "none");
  } finally {
    await prisma.session.deleteMany({ where: { shop } });
    await prisma.shopState.deleteMany({ where: { shop } });
  }
});

test("uninstall cleanup requires a valid webhook HMAC and a matching shop", async () => {
  const secret = "test-secret";
  const body = JSON.stringify({ myshopify_domain: SHOP, domain: "custom.example" });
  const good = uninstallRequest(body, secret, SHOP);
  assert.equal(await authenticUninstallShop(good, secret), SHOP);

  const forged = uninstallRequest(body, "other-secret", SHOP);
  assert.equal(await authenticUninstallShop(forged, secret), null);

  const swapped = uninstallRequest(body, secret, "victim.myshopify.com");
  assert.equal(await authenticUninstallShop(swapped, secret), null);

  const tampered = uninstallRequest(
    JSON.stringify({ myshopify_domain: "victim.myshopify.com" }),
    secret,
    "victim.myshopify.com",
  );
  const tamperedHmac = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  tampered.headers.set("x-shopify-hmac-sha256", tamperedHmac);
  assert.equal(await authenticUninstallShop(tampered, secret), null);
});

function uninstallRequest(body: string, secret: string, shop: string) {
  const hmac = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  return new Request("https://receivekit.fly.dev/webhooks/app/uninstalled", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-shop-domain": shop,
    },
    body,
  });
}

function fakeBilling(options?: { activeName?: string; firstError?: unknown }) {
  const requests: Array<{
    plan: string;
    isTest?: boolean;
    trialDays?: number;
    returnUrl?: string;
  }> = [];
  let attempts = 0;
  const gateway: BillingGateway = {
    check: async () => {
      if (!options?.activeName) {
        return { hasActivePayment: false, appSubscriptions: [] };
      }
      return {
        hasActivePayment: true,
        appSubscriptions: [{ name: options.activeName }],
      };
    },
    request: async (input) => {
      attempts += 1;
      requests.push(input);
      if (options?.firstError && attempts === 1) throw options.firstError;
      throw new Response(null, {
        status: 401,
        headers: {
          "X-Shopify-API-Request-Failure-Reauthorize-Url": CONFIRMATION,
        },
      });
    },
  };
  return { gateway, requests, firstError: options?.firstError };
}

after(async () => {
  await prisma.$disconnect();
});
