import { ensureDemoSeed } from "../app/lib/seed.server";

const shop = process.env.DEMO_SHOP || "demo-receivekit.myshopify.com";
const result = await ensureDemoSeed(shop);
console.log(
  result.seeded
    ? `Seeded demo purchase orders for ${result.shop}`
    : `Demo purchase orders already present for ${result.shop}`,
);
