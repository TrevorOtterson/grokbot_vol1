export const DEMO_SHOP = "demo-receivekit.myshopify.com";

/** Open sample PO created by ensureDemoSeed — keep in sync with seed.server. */
export const SAMPLE_OPEN_PO_NUMBER = "PO-1042";

export const PLANS = [
  {
    key: "dock",
    name: "Dock",
    price: 49,
    blurb: "Receive POs, print labels, lock unit cost at receipt.",
    points: [
      "Open purchase orders and partial receives",
      "Printable barcode label sheets",
      "Cost snapshot locked on every receipt",
    ],
  },
  {
    key: "floor",
    name: "Floor",
    price: 79,
    blurb: "Same receive flow for busier docks and more locations.",
    points: [
      "Everything in Dock",
      "Shopify transfer / shipment receive when APIs allow",
      "Same receive flow as volume and locations grow",
    ],
  },
  {
    key: "yard",
    name: "Yard",
    price: 99,
    blurb: "Highest listed plan for higher-volume receiving.",
    points: [
      "Everything in Floor",
      "Priority for future Shopify PO API coverage",
      "Same MVP feature set — no forecasting or WMS",
    ],
  },
] as const;

export type PlanKey = (typeof PLANS)[number]["key"];

export const PLAN_KEYS = PLANS.map((plan) => plan.key);

export const DOCK_PLAN = "Dock";
export const FLOOR_PLAN = "Floor";
export const YARD_PLAN = "Yard";
