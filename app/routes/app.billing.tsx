import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { DOCK_PLAN, FLOOR_PLAN, PLANS, YARD_PLAN, type PlanKey } from "../lib/constants";
import { requireShop } from "../lib/session.server";
import { getShopState } from "../lib/sync.server";
import prisma from "../db.server";

const PLAN_NAME: Record<PlanKey, string> = {
  dock: DOCK_PLAN,
  floor: FLOOR_PLAN,
  yard: YARD_PLAN,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await requireShop(request);
  const state = await getShopState(shop.shop);

  let shopifyPlan: string | null = null;
  if (shop.billing) {
    try {
      const check = await shop.billing.check({
        plans: [DOCK_PLAN, FLOOR_PLAN, YARD_PLAN],
        isTest: shop.billingTest,
      });
      shopifyPlan = check.appSubscriptions[0]?.name ?? null;
    } catch {
      shopifyPlan = null;
    }
  }

  return {
    demo: shop.demo,
    billingTest: shop.billingTest,
    selected: state.plan,
    billingStatus: state.billingStatus,
    shopifyPlan,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = await requireShop(request);
  const form = await request.formData();
  const plan = String(form.get("plan") || "") as PlanKey;
  if (!PLAN_NAME[plan]) {
    return { ok: false, message: "Choose Dock, Floor, or Yard." };
  }

  await prisma.shopState.upsert({
    where: { shop: shop.shop },
    update: { plan, billingStatus: shop.demo ? "demo" : "pending" },
    create: {
      shop: shop.shop,
      plan,
      billingStatus: shop.demo ? "demo" : "pending",
    },
  });

  if (shop.demo || !shop.billing) {
    return {
      ok: true,
      message: `Demo: ${PLAN_NAME[plan]} selected at $${PLANS.find((item) => item.key === plan)?.price}/30 days. Shopify App Billing is not charged in demo mode.`,
    };
  }

  return shop.billing.request({
    plan: PLAN_NAME[plan],
    isTest: shop.billingTest,
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
  });
};

export default function BillingPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const pendingPlan = String(navigation.formData?.get("plan") || "");

  return (
    <s-page heading="Billing">
      <s-section heading="Shopify App Billing stubs">
        <s-paragraph>
          Three monthly plans via <code>appSubscriptionCreate</code> (test
          charges by default). This MVP does not gate features on plan — the
          charge is the stub merchants will see in a development store.
        </s-paragraph>
        {data.demo ? (
          <s-banner heading="Demo billing" tone="info">
            Selecting a plan is stored locally. No Shopify charge is created
            until the app is installed on a store.
          </s-banner>
        ) : (
          <s-banner heading={data.billingTest ? "Test charges" : "Live charges"} tone="warning">
            {data.shopifyPlan
              ? `Shopify subscription: ${data.shopifyPlan}`
              : "No active Shopify subscription yet."}{" "}
            Set <code>BILLING_TEST_MODE=true</code> so development stores are
            not billed.
          </s-banner>
        )}
        {actionData?.message ? (
          <s-banner heading="Plan updated" tone="success">
            {actionData.message}
          </s-banner>
        ) : null}
      </s-section>

      <s-section>
        <div className="rk-plan-grid">
          {PLANS.map((plan) => (
            <article
              key={plan.key}
              className={`rk-plan ${data.selected === plan.key ? "selected" : ""}`}
            >
              <s-heading>{plan.name}</s-heading>
              <div className="rk-price">
                ${plan.price}
                <span> / 30 days</span>
              </div>
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
                  variant={data.selected === plan.key ? "secondary" : "primary"}
                  {...(submitting && pendingPlan === plan.key ? { loading: true } : {})}
                >
                  {data.selected === plan.key ? "Selected" : `Choose ${plan.name}`}
                </s-button>
              </Form>
            </article>
          ))}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
