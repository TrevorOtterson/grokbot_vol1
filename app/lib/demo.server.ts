export function isDemoMode() {
  return process.env.DEMO_MODE === "true" || process.env.DEMO_MODE === "1";
}

export function billingIsTest() {
  return process.env.BILLING_TEST_MODE !== "false";
}
