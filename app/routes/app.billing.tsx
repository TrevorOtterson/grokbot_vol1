import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  billingModeLabel,
  billingReturnUrl,
  beginPlanRequest,
  BillingRequestFailed,
  decidePlanRequest,
  describeBilling,
  fetchShopPlan,
  readSubscription,
  resolveBillingTest,
  saveBillingState,
  type BillingOutcome,
} from "../lib/billing.server";
import { PLANS, TRIAL_DAYS } from "../lib/constants";
import { requireShop } from "../lib/session.server";
import { getShopState } from "../lib/sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await requireShop(request);
  const state = await getShopState(shop.shop);
  const chargeId = new URL(request.url).searchParams.get("charge_id");

  if (shop.demo || !shop.billing) {
    return {
      demo: true,
      billingTest: true,
      billingMode: billingModeLabel(true),
      highlighted: state.plan,
      outcome: "inactive" as BillingOutcome,
      shopifyPlan: null as string | null,
    };
  }

  const shopPlan = shop.admin ? await fetchShopPlan(shop.admin) : null;
  const subscription = await readSubscription(
    shop.billing,
    resolveBillingTest({ envForcesTest: shop.billingTest, shopPlan }),
  );
  const described = describeBilling({
    hasActivePayment: subscription.hasActivePayment,
    subscriptionName: subscription.subscriptionName,
    chargeId,
    localBillingStatus: state.billingStatus,
  });

  if (described.outcome === "active" || described.outcome === "accepted") {
    if (described.planKey) {
      await saveBillingState(shop.shop, described.planKey, "active");
    }
  } else if (state.billingStatus !== "demo") {
    await saveBillingState(shop.shop, state.plan, "inactive");
  }

  return {
    demo: false,
    billingTest: subscription.billingTest,
    billingMode: billingModeLabel(subscription.billingTest),
    highlighted: described.planKey ?? "",
    outcome: described.outcome,
    shopifyPlan: described.shopifyPlan,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = await requireShop(request);
  const form = await request.formData();
  const planKey = String(form.get("plan") || "");
  const shopPlan =
    shop.demo || !shop.admin ? null : await fetchShopPlan(shop.admin);

  let activeSubscriptionName: string | null = null;
  if (shop.billing) {
    const subscription = await readSubscription(
      shop.billing,
      resolveBillingTest({ envForcesTest: shop.billingTest, shopPlan }),
    );
    activeSubscriptionName = subscription.hasActivePayment
      ? subscription.subscriptionName
      : null;
  }

  const decision = decidePlanRequest({
    planKey,
    demo: shop.demo || !shop.billing,
    activeSubscriptionName,
    envForcesTest: shop.billingTest,
    shopPlan,
  });

  if (decision.type === "invalid") {
    return { ok: false, message: decision.message };
  }

  if (decision.type === "demo") {
    await saveBillingState(shop.shop, decision.plan, "demo");
    return { ok: true, message: decision.message };
  }

  if (decision.type === "already-active") {
    await saveBillingState(shop.shop, decision.plan, "active");
    return { ok: true, message: decision.message };
  }

  const returnUrl = billingReturnUrl({
    shop: shop.shop,
    apiKey: shop.apiKey,
    host: new URL(request.url).searchParams.get("host"),
  });
  if (!returnUrl || !shop.billing) {
    return {
      ok: false,
      message:
        "Could not open Shopify charge approval for this shop. Choose a plan to try again.",
    };
  }

  await saveBillingState(shop.shop, decision.plan, "pending");

  try {
    await beginPlanRequest({
      gateway: shop.billing,
      planName: decision.planName,
      isTest: decision.isTest,
      returnUrl,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof BillingRequestFailed) {
      await saveBillingState(shop.shop, decision.plan, "inactive");
      return { ok: false, message: error.message };
    }
    throw error;
  }
};

export default function BillingPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const pendingPlan = String(navigation.formData?.get("plan") || "");
  const paid =
    data.outcome === "active" || data.outcome === "accepted";

  return (
    <s-page heading="Billing">
      <s-section heading="Shopify App Billing">
        <s-paragraph>
          Dock, Floor, and Yard are monthly plans. Each one includes a{" "}
          {TRIAL_DAYS}-day free trial.           Receive, labels, and cost stay available
          while you approve a plan. Choose a plan to request charge approval
          from Shopify.
        </s-paragraph>
        {data.demo ? (
          <s-banner heading="Demo billing" tone="info">
            Selecting a plan is stored locally. No Shopify charge is created
            until the app is installed on a store.
          </s-banner>
        ) : (
          <s-banner heading={bannerHeading(data.outcome)} tone={bannerTone(data.outcome)}>
            {bannerBody(data.outcome, data.shopifyPlan)} {data.billingMode}
          </s-banner>
        )}
        {actionData?.message ? (
          <s-banner
            heading={actionData.ok ? "Plan updated" : "Charge not started"}
            tone={actionData.ok ? "success" : "critical"}
          >
            {actionData.message}
          </s-banner>
        ) : null}
      </s-section>

      <s-section>
        <div className="rk-plan-grid">
          {PLANS.map((plan) => {
            const current = data.highlighted === plan.key && (data.demo || paid);
            return (
              <article
                key={plan.key}
                className={`rk-plan ${current ? "selected" : ""}`}
              >
                <s-heading>{plan.name}</s-heading>
                <div className="rk-price">
                  ${plan.price}
                  <span> / 30 days</span>
                </div>
                <p className="rk-trial">{TRIAL_DAYS}-day free trial</p>
                <s-paragraph>{plan.blurb}</s-paragraph>
                <s-unordered-list>
                  {plan.points.map((point) => (
                    <s-list-item key={point}>{point}</s-list-item>
                  ))}
                </s-unordered-list>
                <Form method="post">
                  <input type="hidden" name="plan" value={plan.key} />
                  <s-button
                    type="submit"
                    variant={current ? "secondary" : "primary"}
                    {...(submitting && pendingPlan === plan.key ? { loading: true } : {})}
                  >
                    {current
                      ? data.demo
                        ? "Selected"
                        : "Current plan"
                      : `Choose ${plan.name}`}
                  </s-button>
                </Form>
              </article>
            );
          })}
        </div>
      </s-section>
    </s-page>
  );
}

function bannerHeading(outcome: BillingOutcome) {
  if (outcome === "accepted") return "Charge approved";
  if (outcome === "active") return "Subscription active";
  if (outcome === "declined") return "Charge not approved";
  return "Choose a plan";
}

function bannerTone(outcome: BillingOutcome) {
  if (outcome === "accepted" || outcome === "active") return "success" as const;
  if (outcome === "declined") return "warning" as const;
  return "info" as const;
}

function bannerBody(outcome: BillingOutcome, shopifyPlan: string | null) {
  if (outcome === "accepted") {
    return shopifyPlan
      ? `${shopifyPlan} is active. The ${TRIAL_DAYS}-day free trial has started.`
      : `The charge was approved. The ${TRIAL_DAYS}-day free trial has started.`;
  }
  if (outcome === "active") {
    return shopifyPlan
      ? `Shopify subscription: ${shopifyPlan}.`
      : "Shopify subscription is active.";
  }
  if (outcome === "declined") {
    return "The charge was not approved, and nothing was billed. Choose a plan to request approval again.";
  }
  return `No active Shopify subscription. Choose Dock, Floor, or Yard to request approval. Each plan includes a ${TRIAL_DAYS}-day free trial. If you decline, you return here and can request approval again.`;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
