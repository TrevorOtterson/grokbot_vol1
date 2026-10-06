import { ApiVersion } from "@shopify/shopify-app-react-router/server";

/**
 * Latest stable Admin API version (released 2026-10-01, supported through
 * 2026-10-16). `@shopify/shopify-api` 13.1.0 enumerates versions through
 * `July26` only. `October26` is exported from shopify-api 14+, which requires
 * Node 22 and `@shopify/shopify-app-react-router` 2 (that major removes
 * `AppProvider`'s `embedded` prop, used by the login and demo shells).
 *
 * The client sends this string as the `/admin/api/{version}` path. It warns
 * on unknown versions but does not reject them, and its supported-version
 * list is computed from the calendar, which includes `2026-10`.
 */
export const ADMIN_API_VERSION = "2026-10" as ApiVersion;
