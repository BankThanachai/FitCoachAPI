import {
  SubscriptionEnvironment,
  SubscriptionStatus,
  SubscriptionStore,
} from '../../generated/prisma/client';
import { NON_EXPIRING_DATE } from './subscription.constants';
import {
  deriveSubscription,
  RevenueCatSubscriber,
} from './subscription-state.util';

const NOW = new Date('2026-10-10T00:00:00.000Z');
const FUTURE = '2026-11-10T00:00:00.000Z';
const PAST = '2026-09-10T00:00:00.000Z';

function subscriber(
  entitlement: Partial<{
    expires_date: string | null;
    grace_period_expires_date: string | null;
  }> = {},
  subscription: Record<string, unknown> = {},
): RevenueCatSubscriber {
  return {
    entitlements: {
      fitwork_pro: {
        product_identifier: 'monthly',
        expires_date: FUTURE,
        purchase_date: '2026-10-01T00:00:00.000Z',
        ...entitlement,
      },
    },
    subscriptions: {
      monthly: {
        store: 'app_store',
        is_sandbox: false,
        original_purchase_date: '2026-08-01T00:00:00.000Z',
        store_transaction_id: 'txn-1',
        billing_issues_detected_at: null,
        unsubscribe_detected_at: null,
        ...subscription,
      },
    },
  };
}

describe('deriveSubscription', () => {
  it('returns null when the subscriber never had the fitwork_pro entitlement', () => {
    expect(deriveSubscription({}, NOW)).toBeNull();
    expect(
      deriveSubscription(
        {
          entitlements: {
            other: { product_identifier: 'x', expires_date: FUTURE },
          },
        },
        NOW,
      ),
    ).toBeNull();
  });

  it('maps a live subscription to ACTIVE with the store details', () => {
    const result = deriveSubscription(subscriber(), NOW);

    expect(result).toEqual({
      store: SubscriptionStore.APP_STORE,
      productId: 'monthly',
      status: SubscriptionStatus.ACTIVE,
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
      expiresAt: new Date(FUTURE),
      originalTransactionId: 'txn-1',
      environment: SubscriptionEnvironment.PRODUCTION,
      isActive: true,
    });
  });

  it('is CANCELLED but still active when auto-renew was turned off before expiry', () => {
    const result = deriveSubscription(
      subscriber({}, { unsubscribe_detected_at: '2026-10-05T00:00:00.000Z' }),
      NOW,
    );

    expect(result?.status).toBe(SubscriptionStatus.CANCELLED);
    expect(result?.isActive).toBe(true);
  });

  it('is EXPIRED and inactive once expires_date has passed', () => {
    const result = deriveSubscription(subscriber({ expires_date: PAST }), NOW);

    expect(result?.status).toBe(SubscriptionStatus.EXPIRED);
    expect(result?.isActive).toBe(false);
    expect(result?.expiresAt).toEqual(new Date(PAST));
  });

  it('stays active in BILLING_RETRY while the store grace period runs', () => {
    const result = deriveSubscription(
      subscriber(
        { expires_date: PAST, grace_period_expires_date: FUTURE },
        { billing_issues_detected_at: '2026-09-10T00:00:00.000Z' },
      ),
      NOW,
    );

    expect(result?.status).toBe(SubscriptionStatus.BILLING_RETRY);
    expect(result?.isActive).toBe(true);
    expect(result?.expiresAt).toEqual(new Date(FUTURE));
  });

  it('is EXPIRED, not BILLING_RETRY, once the grace period is over too', () => {
    const result = deriveSubscription(
      subscriber(
        { expires_date: PAST, grace_period_expires_date: PAST },
        { billing_issues_detected_at: '2026-09-10T00:00:00.000Z' },
      ),
      NOW,
    );

    expect(result?.status).toBe(SubscriptionStatus.EXPIRED);
    expect(result?.isActive).toBe(false);
  });

  it('flags sandbox purchases without ignoring them', () => {
    const result = deriveSubscription(
      subscriber({}, { is_sandbox: true }),
      NOW,
    );

    expect(result?.environment).toBe(SubscriptionEnvironment.SANDBOX);
    expect(result?.isActive).toBe(true);
  });

  it.each([
    ['play_store', SubscriptionStore.PLAY_STORE],
    ['mac_app_store', SubscriptionStore.APP_STORE],
    ['test_store', SubscriptionStore.OTHER],
    ['promotional', SubscriptionStore.OTHER],
  ])('maps RevenueCat store %s to %s', (store, expected) => {
    expect(deriveSubscription(subscriber({}, { store }), NOW)?.store).toBe(
      expected,
    );
  });

  it('treats a null expires_date as non-expiring', () => {
    const result = deriveSubscription(subscriber({ expires_date: null }), NOW);

    expect(result?.expiresAt).toEqual(NON_EXPIRING_DATE);
    expect(result?.isActive).toBe(true);
  });

  it('throws rather than guess when expires_date is unparseable', () => {
    expect(() =>
      deriveSubscription(subscriber({ expires_date: 'not-a-date' }), NOW),
    ).toThrow('unparseable expires_date');
  });
});
