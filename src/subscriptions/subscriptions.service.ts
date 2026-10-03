import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  Subscription,
  SubscriptionStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RevenueCatWebhookDto } from './dto/revenuecat-webhook.dto';
import { RevenueCatService } from './revenuecat.service';
import {
  FREE_PORTFOLIO_PHOTO_LIMIT,
  NON_EXPIRING_DATE,
  PRO_PORTFOLIO_PHOTO_LIMIT,
} from './subscription.constants';
import { deriveSubscription } from './subscription-state.util';

/** The caller's own subscription, as returned by GET /subscriptions/me and POST /subscriptions/sync. */
export function toSubscriptionResponse(
  subscription: Subscription | null,
  now: Date,
) {
  // Judged from expiresAt, never from User.isPro: that flag can lag a missed
  // webhook by up to a day, and this is what gates real entitlements.
  const isPro = !!subscription && subscription.expiresAt > now;
  return {
    isPro,
    status: subscription
      ? isPro
        ? subscription.status
        : SubscriptionStatus.EXPIRED
      : null,
    productId: subscription?.productId ?? null,
    store: subscription?.store ?? null,
    startedAt: subscription?.startedAt ?? null,
    expiresAt:
      subscription && subscription.expiresAt < NON_EXPIRING_DATE
        ? subscription.expiresAt
        : null,
    portfolioPhotoLimit: isPro
      ? PRO_PORTFOLIO_PHOTO_LIMIT
      : FREE_PORTFOLIO_PHOTO_LIMIT,
  };
}

/** Our own user ids mentioned by a RevenueCat event (TRANSFER events carry two lists instead of app_user_id). */
function collectAppUserIds(event: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) {
      ids.add(value);
    }
  };
  add(event.app_user_id);
  for (const key of ['transferred_from', 'transferred_to']) {
    const value = event[key];
    if (Array.isArray(value)) {
      value.forEach(add);
    }
  }
  return [...ids];
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenueCat: RevenueCatService,
  ) {}

  async getMine(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    return toSubscriptionResponse(subscription, new Date());
  }

  /** Whether this user's Pro is active right now, judged from expiresAt (not the User.isPro flag). */
  async isProActive(userId: string): Promise<boolean> {
    const active = await this.prisma.subscription.findFirst({
      where: { userId, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return !!active;
  }

  async getPortfolioPhotoLimit(userId: string): Promise<number> {
    return (await this.isProActive(userId))
      ? PRO_PORTFOLIO_PHOTO_LIMIT
      : FREE_PORTFOLIO_PHOTO_LIMIT;
  }

  /**
   * Re-reads one user's Pro entitlement from RevenueCat and mirrors it into
   * Subscription + User.isPro. This is the only writer of that state: the
   * webhook and POST /subscriptions/sync both just call it, so neither has to
   * interpret individual event types.
   */
  async syncFromRevenueCat(userId: string) {
    const subscriber = await this.revenueCat.getSubscriber(userId);
    const now = new Date();
    const derived = subscriber ? deriveSubscription(subscriber, now) : null;

    if (derived) {
      const { isActive, ...data } = derived;
      await this.prisma.$transaction([
        this.prisma.subscription.upsert({
          where: { userId },
          create: { userId, ...data, lastSyncedAt: now },
          update: { ...data, lastSyncedAt: now },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { isPro: isActive },
        }),
      ]);
    } else {
      // RevenueCat no longer reports the entitlement at all (e.g. revoked or
      // refunded): end any subscription we still have on file right now.
      await this.prisma.$transaction([
        this.prisma.subscription.updateMany({
          where: { userId, expiresAt: { gt: now } },
          data: { expiresAt: now },
        }),
        this.prisma.subscription.updateMany({
          where: { userId },
          data: { status: SubscriptionStatus.EXPIRED, lastSyncedAt: now },
        }),
        this.prisma.user.updateMany({
          where: { id: userId },
          data: { isPro: false },
        }),
      ]);
    }

    return this.getMine(userId);
  }

  /**
   * RevenueCat calls this directly (guarded by RevenueCatWebhookGuard). The
   * body is never trusted for state — it only says which of our users changed
   * (same approach as PaymentsService.handleWebhookEvent). A failed sync is
   * left to throw so RevenueCat gets a 5xx and retries later.
   */
  async handleWebhookEvent(body: RevenueCatWebhookDto) {
    const { event } = body;
    const eventId = typeof event.id === 'string' ? event.id : undefined;
    if (!eventId) {
      throw new BadRequestException('Webhook event is missing an id');
    }
    const eventType = typeof event.type === 'string' ? event.type : 'UNKNOWN';

    const existingEvent = await this.prisma.subscriptionEvent.findUnique({
      where: { eventId },
    });
    if (existingEvent) {
      return { deduplicated: true, matched: false };
    }

    // Anonymous RevenueCat ids ($RCAnonymousID:...) and anything else that
    // isn't one of our users simply never match, so those events are ignored.
    const candidateIds = collectAppUserIds(event);
    const users =
      candidateIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: candidateIds } },
            select: { id: true },
          })
        : [];
    if (users.length === 0) {
      return { deduplicated: false, matched: false };
    }

    for (const user of users) {
      await this.syncFromRevenueCat(user.id);
    }

    try {
      await this.prisma.subscriptionEvent.create({
        data: {
          userId: users[0].id,
          eventId,
          eventType,
          rawPayload: body as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Two deliveries of the same event raced past the check above. The sync
      // is idempotent, so the loser just reports it as a duplicate.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { deduplicated: true, matched: true };
      }
      throw error;
    }

    return { deduplicated: false, matched: true };
  }

  /**
   * Safety net for a lost EXPIRATION webhook: switch off the Pro flag for
   * anyone whose subscription has run out. A single UPDATE that only touches
   * rows still marked isPro, so running it twice (or on several instances at
   * once) gives the same result.
   */
  async expireLapsedSubscriptions(now = new Date()): Promise<number> {
    const result = await this.prisma.user.updateMany({
      where: {
        isPro: true,
        subscription: {
          is: {
            OR: [
              { expiresAt: { lte: now } },
              { status: SubscriptionStatus.EXPIRED },
            ],
          },
        },
      },
      data: { isPro: false },
    });
    return result.count;
  }
}
