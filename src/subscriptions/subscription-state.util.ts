import {
  SubscriptionEnvironment,
  SubscriptionStatus,
  SubscriptionStore,
} from '../../generated/prisma/client';
import {
  NON_EXPIRING_DATE,
  PRO_ENTITLEMENT_ID,
} from './subscription.constants';

// Only the fields of RevenueCat's GET /v1/subscribers/{app_user_id} response
// that we read. Everything is optional/nullable on purpose: this is parsed
// from a third-party payload, so we never assume a field is there.
export interface RevenueCatEntitlement {
  product_identifier: string;
  expires_date: string | null;
  grace_period_expires_date?: string | null;
  purchase_date?: string | null;
}

export interface RevenueCatSubscription {
  store?: string | null;
  is_sandbox?: boolean | null;
  original_purchase_date?: string | null;
  billing_issues_detected_at?: string | null;
  unsubscribe_detected_at?: string | null;
  store_transaction_id?: string | null;
}

export interface RevenueCatSubscriber {
  entitlements?: Record<string, RevenueCatEntitlement>;
  subscriptions?: Record<string, RevenueCatSubscription>;
}

export interface DerivedSubscription {
  store: SubscriptionStore;
  productId: string;
  status: SubscriptionStatus;
  startedAt: Date;
  expiresAt: Date;
  originalTransactionId: string | null;
  environment: SubscriptionEnvironment;
  /** True while Pro should currently be switched on (expiresAt is still in the future). */
  isActive: boolean;
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    // Fail loudly rather than guess: a mis-parsed expiry would either lock a
    // paying user out or hand out Pro for free.
    throw new Error(`RevenueCat returned an unparseable ${field}: ${value}`);
  }
  return date;
}

function mapStore(store: string | null | undefined): SubscriptionStore {
  switch (store) {
    case 'app_store':
    case 'mac_app_store':
      return SubscriptionStore.APP_STORE;
    case 'play_store':
      return SubscriptionStore.PLAY_STORE;
    default:
      return SubscriptionStore.OTHER;
  }
}

/**
 * Turns RevenueCat's view of a subscriber into the state we persist, judging
 * purely from the `fitwork_pro` entitlement — never from a webhook payload.
 * Returns null if the subscriber has never had that entitlement.
 *
 * `BILLING_RETRY` + a future `expiresAt` is the store's grace period: we keep
 * Pro on for as long as RevenueCat itself still reports the entitlement as
 * active, rather than inventing a grace window of our own.
 */
export function deriveSubscription(
  subscriber: RevenueCatSubscriber,
  now: Date,
): DerivedSubscription | null {
  const entitlement = subscriber.entitlements?.[PRO_ENTITLEMENT_ID];
  if (!entitlement) {
    return null;
  }

  const subscription =
    subscriber.subscriptions?.[entitlement.product_identifier];

  let expiresAt: Date;
  if (entitlement.expires_date === null) {
    expiresAt = NON_EXPIRING_DATE;
  } else {
    expiresAt = parseDate(entitlement.expires_date, 'expires_date');
    if (entitlement.grace_period_expires_date) {
      const graceExpiresAt = parseDate(
        entitlement.grace_period_expires_date,
        'grace_period_expires_date',
      );
      if (graceExpiresAt > expiresAt) {
        expiresAt = graceExpiresAt;
      }
    }
  }

  const isActive = expiresAt > now;

  let status: SubscriptionStatus;
  if (!isActive) {
    status = SubscriptionStatus.EXPIRED;
  } else if (subscription?.billing_issues_detected_at) {
    status = SubscriptionStatus.BILLING_RETRY;
  } else if (subscription?.unsubscribe_detected_at) {
    status = SubscriptionStatus.CANCELLED;
  } else {
    status = SubscriptionStatus.ACTIVE;
  }

  const startedAtRaw =
    subscription?.original_purchase_date ?? entitlement.purchase_date;

  return {
    store: mapStore(subscription?.store),
    productId: entitlement.product_identifier,
    status,
    startedAt: startedAtRaw ? parseDate(startedAtRaw, 'purchase_date') : now,
    expiresAt,
    // The latest store transaction id is the closest thing the REST API
    // exposes to a store-side reference for this subscription.
    originalTransactionId: subscription?.store_transaction_id ?? null,
    environment: subscription?.is_sandbox
      ? SubscriptionEnvironment.SANDBOX
      : SubscriptionEnvironment.PRODUCTION,
    isActive,
  };
}
