/** RevenueCat entitlement that unlocks FitWork Pro (RevenueCat dashboard > Entitlements). */
export const PRO_ENTITLEMENT_ID = 'fitwork_pro';

export const FREE_PORTFOLIO_PHOTO_LIMIT = 5;
export const PRO_PORTFOLIO_PHOTO_LIMIT = 20;

/**
 * Stored as Subscription.expiresAt for an entitlement RevenueCat reports with
 * no expiry (e.g. a lifetime promotional grant), so every "is this still
 * active" check can stay a plain `expiresAt > now`. Never shown to the app —
 * see toSubscriptionResponse.
 */
export const NON_EXPIRING_DATE = new Date('9999-12-31T00:00:00.000Z');
