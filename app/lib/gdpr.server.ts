import db from "../db.server";

/**
 * ReceiveKit stores shop sessions, receive/PO/cost records, and OAuth tokens.
 * It does not store storefront shopper profiles, order PII, or customer
 * mailing lists. Compliance webhooks still must exist for App Store listing.
 *
 * Do not log customer email/phone from webhook payloads.
 */

export async function redactShopData(shop: string) {
  await db.$transaction([
    db.session.deleteMany({ where: { shop } }),
    db.shopState.deleteMany({ where: { shop } }),
    db.purchaseOrder.deleteMany({ where: { shop } }),
  ]);
}
