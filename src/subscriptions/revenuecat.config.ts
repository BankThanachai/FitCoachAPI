// Read lazily and never required at boot (unlike omiseConfig) — the rest of
// the API must keep working in a dev environment that has no RevenueCat
// project yet. Callers decide what a missing value means for them.
export const revenueCatConfig = {
  /** Value configured as "Authorization header" on the RevenueCat webhook; sent back verbatim on every delivery. */
  get webhookAuth(): string | undefined {
    return process.env.REVENUECAT_WEBHOOK_AUTH || undefined;
  },
  /** Secret (sk_...) API key, used to fetch a subscriber from the REST API. */
  get secretApiKey(): string | undefined {
    return process.env.REVENUECAT_SECRET_API_KEY || undefined;
  },
};
