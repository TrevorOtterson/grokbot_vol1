# ReceiveKit

Embedded Shopify admin app for the post-Stocky dock: **receive a purchase order (including partials), print barcode labels, lock unit cost on the receipt.**

That is the whole product. If a feature is not receive, labels, or cost-at-receipt, it does not belong here.

## MVP boundary (locked)

| In | Out |
| --- | --- |
| PO list / open receive | Forecasting |
| Partial receives | Full WMS / bins / picking |
| Printable CODE128 label sheet (HTML → browser print / PDF) | Transfers suite |
| Unit cost snapshot on each receipt | B2B portal |
| Write `InventoryItem.cost` when Admin GraphQL allows | Reorder, catalogs, net terms, AI |

Plans are billing stubs only: **Dock $49 / Floor $79 / Yard $99** per 30 days. This MVP does not feature-gate those prices.

## Quick start

### Demo (no Partner store)

Requires Node 20.19+ or 22.12+ (see `package.json` engines).

```bash
cp .env.example .env
npm install
npm run setup
npm run demo
```

Open [http://127.0.0.1:43173](http://127.0.0.1:43173) and click **Open demo dock**.

`npm run demo` sets `DEMO_MODE=true` and serves the embedded UI outside Shopify Admin. Receives still lock quantities and cost in SQLite; they do not call Shopify.

### Shopify CLI (embedded on a test store)

```bash
npm install -g @shopify/cli@latest
cp .env.example .env
npm install
npm run setup
npm run dev
```

`npm run dev` is `shopify app dev`. The CLI creates/links an app, tunnels the server, and opens the install screen on a development store.

## Environment variables

Copy `.env.example`. `shopify app dev` overwrites several of these.

| Variable | Purpose |
| --- | --- |
| `DEMO_MODE` | `true` skips OAuth and seeds demo POs. **`false` or unset on Fly prod.** |
| `PORT` | Dev **43173**; Fly / Docker **3000** |
| `DATABASE_URL` | Unset locally (SQLite). Postgres URL on Fly from `fly postgres attach`. |
| `SHOPIFY_APP_URL` | Public app URL (CLI sets this in dev). On Fly: `https://<your-app>.fly.dev` |
| `SHOPIFY_API_KEY` | App client ID |
| `SHOPIFY_API_SECRET` | App secret |
| `SCOPES` | Must match `shopify.app.toml` |
| `SHOP_CUSTOM_DOMAIN` | Optional custom shop domain |
| `BILLING_TEST_MODE` | Default `true` — Shopify test charges. **`false` on Fly prod only.** |

## Partner Dashboard / Dev Dashboard setup

1. Create a Partner account and a **development store** (not a Plus sandbox unless you already have one).
2. In **Dev Dashboard**, create an app named ReceiveKit (or run `shopify app dev` / `shopify app config link` and let CLI create it).
3. Use the React Router app in this repo — do not start from a different template and paste files over it.
4. Set **embedded** app, distribution **Shopify App Store** (or custom distribution for a single shop).
5. Copy the Client ID into `shopify.app.toml` `client_id` (CLI `config link` does this).
6. Confirm scopes match `[access_scopes]` in `shopify.app.toml`:
   - `read_products,write_products`
   - `read_inventory,write_inventory`
   - `read_locations`
   - `read_inventory_transfers,write_inventory_transfers`
   - `write_inventory_shipments,write_inventory_shipments_received_items`
7. Webhooks in the TOML subscribe to `app/uninstalled`, `app/scopes_update`, and the three mandatory GDPR topics (`customers/data_request`, `customers/redact`, `shop/redact`).
8. Billing: keep **test charges** enabled while developing. Plans are declared in `app/shopify.server.ts` (`Dock` / `Floor` / `Yard`). Set `BILLING_TEST_MODE=false` only on the Fly production app.

## Test store steps

1. `npm run dev` and install ReceiveKit on the development store.
2. Open the app from **Apps** in Shopify admin. You should see the PO list (empty until you seed or sync).
3. Demo seed only auto-runs in `DEMO_MODE`. On a live Partner/dev store with an empty dock, use the empty-state CTAs:
   - **Sync Shopify transfers** — import inbound `inventoryTransfers` as receive documents.
   - **Seed sample receives** — load three practice POs (open / partial / complete) for **this shop**. Ids are scoped per shop domain so they do not collide with the global demo rows (`po_open_apex`, …).
   - **How to get your first receive** — 3-step checklist and short FAQ (`/app/help`).
   If sync returns nothing, the shop has no open inbound transfers — seed for practice, then receive PO-1042.
4. Open a PO → enter accept quantities (or **Fill remaining**) → set unit cost → **Receive and lock cost**.
5. Print labels: 3-up letter sheet, CODE128, browser Print to PDF.
6. **Billing**: pick Dock/Floor/Yard. Approve the **test** recurring charge. You should return to `/app/billing`.
7. Confirm in Shopify admin that `InventoryItem` unit cost changed **only if** the line had an InventoryItem GID (imported transfers do; demo-only lines do not).

To reset demo data, delete `prisma/dev.sqlite` and run `npm run setup`.

## Production (Fly.io + Postgres)

One stack: **Fly Machines from the existing Dockerfile** (port **3000**) + **Fly Postgres**. Do not commit secrets.

1. `fly auth login` and from this repo: `fly launch` (keep the existing Dockerfile; set `internal_port` **3000**).
2. `fly postgres create` then `fly postgres attach <db-app>` (sets `DATABASE_URL`).
3. Set secrets (values stay on Fly — never in git):

   ```bash
   fly secrets set \
     SHOPIFY_API_KEY= \
     SHOPIFY_API_SECRET= \
     SCOPES=read_products,write_products,read_inventory,write_inventory,read_locations,read_inventory_transfers,write_inventory_transfers,write_inventory_shipments,write_inventory_shipments_received_items \
     SHOPIFY_APP_URL=https://<your-app>.fly.dev \
     BILLING_TEST_MODE=false \
     DEMO_MODE=false
   ```

   `SHOPIFY_APP_URL` is the public HTTPS origin, no trailing slash. Replace `<your-app>.fly.dev` with the hostname `fly launch` prints.

4. `fly deploy`. Boot runs `npm run docker-start`: Prisma generate + `migrate deploy` (Postgres, no seed) then `npm run start`.
5. Point `shopify.app.toml` `application_url` and `[auth] redirect_urls` at that Fly origin, then `npm run deploy` / `shopify app deploy`.

Dockerfile `ENV PORT=3000` matches Fly `internal_port`. `NODE_ENV=production` is already set in the image.

**Prisma:** production schema is `prisma/schema.prisma` (`provider = "postgresql"`, `url = env("DATABASE_URL")`). `prisma migrate deploy` applies `prisma/migrations/` on Postgres. Local demo keeps SQLite via `prisma/sqlite/schema.prisma` and `prisma/sqlite/migrations/` — `npm run setup` / `npm run demo` pick SQLite unless `DATABASE_URL` starts with `postgres`.

Do **not** set `BILLING_TEST_MODE=false` on receivekit-dev or local `.env`.

## GDPR / privacy

Mandatory App Store compliance webhooks are implemented and declared in `shopify.app.toml`:

| Topic | Route | What ReceiveKit does |
| --- | --- | --- |
| `customers/data_request` | `/webhooks/customers/data_request` | HMAC via `authenticate.webhook`; 200. No storefront customer profiles to export. |
| `customers/redact` | `/webhooks/customers/redact` | HMAC; 200. No shopper PII to delete (`Session.email` is merchant staff OAuth). |
| `shop/redact` | `/webhooks/shop/redact` | HMAC; deletes sessions, shop state, and receive/PO rows for that shop. |
| `app/uninstalled` | `/webhooks/app/uninstalled` | Deletes **Session** rows immediately. |

Invalid HMAC fails authentication (401). Valid webhooks are acknowledged with an empty 200. Payloads that include customer email/phone are not logged.

**Honesty:** ReceiveKit stores shop domain, OAuth tokens, purchase-order / receive / unit-cost records — not storefront shopper profiles. The three GDPR endpoints are still required for public apps.

Listing privacy policy URL: [https://bejewelled-kashata-9c39f8.netlify.app/](https://bejewelled-kashata-9c39f8.netlify.app/)

### QA on receivekit-dev

Use a Partner development store (commonly `receivekit-dev.myshopify.com`) with **zero** ReceiveKit POs:

1. `npm run dev`, install/open the app from **Apps**. Confirm the empty dock: **Sync Shopify transfers**, **Seed sample receives**, **How to get your first receive**, plus the inline 3-step checklist.
2. Click **Seed sample receives**. You should land on three POs (PO-1042 open, PO-1038 partial, PO-1021 received) and a success banner: “3 sample POs ready — open PO-1042 to receive.” Seed must not unique-constraint against the demo catalog — sample ids are suffixed per shop.
3. Open PO-1042 → receive a line → print labels. Seed button is gone once any PO exists.
4. Open **First receive** (`/app/help`) and **Billing**. Floor must not mention test-mode billing.

## How receive writes to Shopify

When a store is connected, a receive:

1. Always writes an immutable `Receipt` + `ReceiptLine` in this app (unit cost + PO-weighted average).
2. If the line has `inventoryItemGid` and a location: `inventoryAdjustQuantities` with reason `received` against `available`.
3. If the line has `inventoryItemGid`: `inventoryItemUpdate` with `input.cost` set to the **PO-weighted average** after this receipt.

Partial receives are first-class: remaining qty stays open until ordered == received.

## API gaps (honest)

Shopify Admin GraphQL as of API version **2025-10** (`ApiVersion.October25`):

| Need | What exists | Gap |
| --- | --- | --- |
| List/create merchant POs | Native POs exist in **Shopify admin** after Stocky. Public **read** is `inventoryPurchaseOrder(s)` on **`unstable`** only, behind the [Physical inventory feature preview](https://shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps/physical-inventory-feature-preview). | No stable PO CRUD. **No public receive-on-PO mutation.** |
| Receive goods | [Inventory transfers + shipments](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventoryShipmentReceive): `inventoryShipmentReceive`, `inventoryShipmentCreate`. Admin help: receiving happens on the **linked transfer**, not the PO. | Merchant POs and transfers are separate objects. This app models POs itself and can import transfers as receive documents. |
| Increase on-hand without a transfer | `inventoryAdjustQuantities` (`reason: received`) | Requires location + InventoryItem IDs. |
| Lock unit / average cost | `inventoryItemUpdate(input: { cost })` writes `InventoryItem.unitCost`. | **Last write wins.** There is no public “lock this receipt into Shopify’s average cost ledger” mutation. ReceiveKit stores the receipt unit cost and writes a PO-weighted average to `cost`. That is not shop-wide moving average (it ignores stock not on this PO). |
| Barcode labels | None as a Shopify primitive | HTML sheet + [JsBarcode](https://github.com/lindell/JsBarcode) CODE128. Print or Save as PDF. No ZPL/printer SDK in this MVP. |

ReceiveKit therefore:

- Seeds app-owned POs in demo.
- Optionally imports `inventoryTransfers` (stable) when connected.
- Attempts `inventoryPurchaseOrders` on `unstable` during sync and records the result in `ShopState.lastSyncNote` without failing the receive flow.

## App Store listing checklist

Not required to run the MVP. Needed before a public listing:

- [ ] Partner app record, branding, and `client_id` committed via `shopify app config link`
- [ ] Production host: Fly.io from this Dockerfile (`PORT=3000`, `npm run docker-start`)
- [x] Postgres schema + `prisma migrate deploy` path (`prisma/schema.prisma`); local SQLite dual schema documented
- [x] GDPR compliance webhooks implemented and declared in TOML
- [x] Privacy policy URL: https://bejewelled-kashata-9c39f8.netlify.app/ (paste on the listing; copy is receive / labels / cost only — do not promise Stocky parity)
- [ ] Screenshots: PO list, receive with partials, label sheet, billing
- [ ] Recurring charges Dock/Floor/Yard configured; `BILLING_TEST_MODE=false` on Fly prod only
- [ ] App review notes explaining PO API limits (unstable read, receive via transfer/adjust, cost = `InventoryItem.cost`)
- [ ] Theme app extension: **not used** (admin-only)
- [ ] Built for Shopify: performance, session token auth (this template), and no blocked checkout APIs
- [x] Support contact and uninstall webhook wiping `Session` rows (`webhooks.app.uninstalled.tsx`); `shop/redact` wipes remaining shop data

## Scripts

| Script | What it does |
| --- | --- |
| `npm run demo` | SQLite migrate + seed + React Router dev on port 43173 |
| `npm run dev` | `shopify app dev` (OAuth, tunnel, embed) |
| `npm run setup` | Generate + migrate deploy + seed (SQLite unless `DATABASE_URL` is Postgres) |
| `npm run docker-start` | Generate + `prisma migrate deploy` (no seed) + production start |
| `npm run build` / `npm start` | Production server |
| `npm test` | Receive / money unit tests |
| `npm run typecheck` | `react-router typegen && tsc` |
| `npm run deploy` | `shopify app deploy` (extensions/config) |

## Stack

Official **Shopify app template — React Router 7** (current CLI default; successor to the Remix template). Polaris web components, App Bridge, Prisma (SQLite locally, Postgres on Fly), Admin GraphQL 2025-10.

## License

The Shopify template license is in `LICENSE.md`. ReceiveKit application code in this repository is provided as a starting point for a deployable app.
