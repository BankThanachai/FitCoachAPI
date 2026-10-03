import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Prisma,
  Subscription,
  SubscriptionEnvironment,
  SubscriptionStatus,
  SubscriptionStore,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RevenueCatService } from './revenuecat.service';
import {
  FREE_PORTFOLIO_PHOTO_LIMIT,
  NON_EXPIRING_DATE,
  PRO_PORTFOLIO_PHOTO_LIMIT,
} from './subscription.constants';
import {
  SubscriptionsService,
  toSubscriptionResponse,
} from './subscriptions.service';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    userId: USER_ID,
    store: SubscriptionStore.APP_STORE,
    productId: 'monthly',
    status: SubscriptionStatus.ACTIVE,
    startedAt: new Date('2026-08-01T00:00:00.000Z'),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    originalTransactionId: 'txn-1',
    environment: SubscriptionEnvironment.PRODUCTION,
    lastSyncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function activeSubscriber() {
  return {
    entitlements: {
      fitwork_pro: {
        product_identifier: 'monthly',
        expires_date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      },
    },
    subscriptions: { monthly: { store: 'app_store', is_sandbox: false } },
  };
}

describe('toSubscriptionResponse', () => {
  const now = new Date();

  it('reports a free account when there is no subscription', () => {
    expect(toSubscriptionResponse(null, now)).toEqual({
      isPro: false,
      status: null,
      productId: null,
      store: null,
      startedAt: null,
      expiresAt: null,
      portfolioPhotoLimit: FREE_PORTFOLIO_PHOTO_LIMIT,
    });
  });

  it('reports Pro with the higher photo limit while expiresAt is in the future', () => {
    const subscription = makeSubscription();
    const result = toSubscriptionResponse(subscription, now);

    expect(result.isPro).toBe(true);
    expect(result.status).toBe(SubscriptionStatus.ACTIVE);
    expect(result.expiresAt).toEqual(subscription.expiresAt);
    expect(result.portfolioPhotoLimit).toBe(PRO_PORTFOLIO_PHOTO_LIMIT);
  });

  it('judges Pro from expiresAt even if the stored status still says ACTIVE', () => {
    const stale = makeSubscription({
      status: SubscriptionStatus.ACTIVE,
      expiresAt: new Date(now.getTime() - 1000),
    });
    const result = toSubscriptionResponse(stale, now);

    expect(result.isPro).toBe(false);
    expect(result.status).toBe(SubscriptionStatus.EXPIRED);
    expect(result.portfolioPhotoLimit).toBe(FREE_PORTFOLIO_PHOTO_LIMIT);
  });

  it('keeps CANCELLED visible while Pro still works until expiresAt', () => {
    const result = toSubscriptionResponse(
      makeSubscription({ status: SubscriptionStatus.CANCELLED }),
      now,
    );

    expect(result.isPro).toBe(true);
    expect(result.status).toBe(SubscriptionStatus.CANCELLED);
  });

  it('hides the non-expiring sentinel date from the app', () => {
    const result = toSubscriptionResponse(
      makeSubscription({ expiresAt: NON_EXPIRING_DATE }),
      now,
    );

    expect(result.isPro).toBe(true);
    expect(result.expiresAt).toBeNull();
  });
});

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let revenueCat: { getSubscriber: jest.Mock };
  let prisma: {
    $transaction: jest.Mock;
    subscription: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
    subscriptionEvent: { findUnique: jest.Mock; create: jest.Mock };
    user: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(async () => {
    revenueCat = { getSubscriber: jest.fn() };
    prisma = {
      // Array form (Prisma batch transaction): the operations were already
      // invoked to build the array, so resolving it is all that's left.
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      subscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      subscriptionEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RevenueCatService, useValue: revenueCat },
      ],
    }).compile();

    service = module.get(SubscriptionsService);
  });

  describe('isProActive / getPortfolioPhotoLimit', () => {
    it('is Pro only when a subscription with a future expiresAt exists', async () => {
      prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1' });

      await expect(service.isProActive(USER_ID)).resolves.toBe(true);
      await expect(service.getPortfolioPhotoLimit(USER_ID)).resolves.toBe(
        PRO_PORTFOLIO_PHOTO_LIMIT,
      );
      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { userId: USER_ID, expiresAt: { gt: expect.any(Date) as Date } },
        select: { id: true },
      });
    });

    it('is free otherwise', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await expect(service.isProActive(USER_ID)).resolves.toBe(false);
      await expect(service.getPortfolioPhotoLimit(USER_ID)).resolves.toBe(
        FREE_PORTFOLIO_PHOTO_LIMIT,
      );
    });
  });

  describe('syncFromRevenueCat', () => {
    it('upserts the subscription and turns User.isPro on for an active entitlement', async () => {
      revenueCat.getSubscriber.mockResolvedValue(activeSubscriber());

      await service.syncFromRevenueCat(USER_ID);

      expect(revenueCat.getSubscriber).toHaveBeenCalledWith(USER_ID);
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID },
          create: expect.objectContaining({
            userId: USER_ID,
            productId: 'monthly',
            status: SubscriptionStatus.ACTIVE,
          }) as unknown,
          update: expect.objectContaining({
            productId: 'monthly',
            status: SubscriptionStatus.ACTIVE,
          }) as unknown,
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: true },
      });
    });

    it('never persists the derived isActive helper as a column', async () => {
      revenueCat.getSubscriber.mockResolvedValue(activeSubscriber());

      await service.syncFromRevenueCat(USER_ID);

      const [{ create, update }] = prisma.subscription.upsert.mock.calls[0] as [
        { create: object; update: object },
      ];
      expect(create).not.toHaveProperty('isActive');
      expect(update).not.toHaveProperty('isActive');
    });

    it('turns User.isPro off when the entitlement has expired', async () => {
      revenueCat.getSubscriber.mockResolvedValue({
        entitlements: {
          fitwork_pro: {
            product_identifier: 'monthly',
            expires_date: '2026-01-01T00:00:00.000Z',
          },
        },
      });

      await service.syncFromRevenueCat(USER_ID);

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: SubscriptionStatus.EXPIRED,
          }) as unknown,
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: false },
      });
    });

    it('ends any subscription on file when RevenueCat no longer reports the entitlement', async () => {
      revenueCat.getSubscriber.mockResolvedValue({ entitlements: {} });

      await service.syncFromRevenueCat(USER_ID);

      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, expiresAt: { gt: expect.any(Date) as Date } },
        data: { expiresAt: expect.any(Date) as Date },
      });
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        data: {
          status: SubscriptionStatus.EXPIRED,
          lastSyncedAt: expect.any(Date) as Date,
        },
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: false },
      });
    });

    it('treats an unknown RevenueCat subscriber the same as no entitlement', async () => {
      revenueCat.getSubscriber.mockResolvedValue(null);

      await service.syncFromRevenueCat(USER_ID);

      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: false },
      });
    });

    it('does not swallow a RevenueCat failure (so the webhook gets a 5xx and is retried)', async () => {
      revenueCat.getSubscriber.mockRejectedValue(new Error('RevenueCat down'));

      await expect(service.syncFromRevenueCat(USER_ID)).rejects.toThrow(
        'RevenueCat down',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhookEvent', () => {
    const body = (event: Record<string, unknown>) => ({
      api_version: '1.0',
      event,
    });

    beforeEach(() => {
      revenueCat.getSubscriber.mockResolvedValue(activeSubscriber());
    });

    it('rejects an event with no id', async () => {
      await expect(
        service.handleWebhookEvent(body({ type: 'RENEWAL' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips an event it has already processed without syncing again', async () => {
      prisma.subscriptionEvent.findUnique.mockResolvedValue({ id: 'seen' });

      const result = await service.handleWebhookEvent(
        body({ id: 'evt-1', type: 'RENEWAL', app_user_id: USER_ID }),
      );

      expect(result).toEqual({ deduplicated: true, matched: false });
      expect(revenueCat.getSubscriber).not.toHaveBeenCalled();
      expect(prisma.subscriptionEvent.create).not.toHaveBeenCalled();
    });

    it('ignores an event whose app_user_id is not one of our users (e.g. anonymous)', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.handleWebhookEvent(
        body({
          id: 'evt-1',
          type: 'INITIAL_PURCHASE',
          app_user_id: '$RCAnonymousID:abc',
        }),
      );

      expect(result).toEqual({ deduplicated: false, matched: false });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['$RCAnonymousID:abc'] } },
        select: { id: true },
      });
      expect(revenueCat.getSubscriber).not.toHaveBeenCalled();
      expect(prisma.subscriptionEvent.create).not.toHaveBeenCalled();
    });

    it('syncs the matching user from RevenueCat and records the event', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);
      const event = { id: 'evt-1', type: 'RENEWAL', app_user_id: USER_ID };

      const result = await service.handleWebhookEvent(body(event));

      expect(result).toEqual({ deduplicated: false, matched: true });
      expect(revenueCat.getSubscriber).toHaveBeenCalledWith(USER_ID);
      expect(prisma.subscriptionEvent.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          eventId: 'evt-1',
          eventType: 'RENEWAL',
          rawPayload: body(event),
        },
      });
    });

    it('never trusts the payload for state — it only picks which user to re-sync', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);
      revenueCat.getSubscriber.mockResolvedValue({ entitlements: {} });

      await service.handleWebhookEvent(
        body({
          id: 'evt-1',
          type: 'INITIAL_PURCHASE',
          app_user_id: USER_ID,
          expiration_at_ms: Date.now() + 1e10,
        }),
      );

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: false },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('syncs both sides of a TRANSFER event', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: USER_ID },
        { id: OTHER_USER_ID },
      ]);

      await service.handleWebhookEvent(
        body({
          id: 'evt-1',
          type: 'TRANSFER',
          transferred_from: [USER_ID],
          transferred_to: [OTHER_USER_ID],
        }),
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: [USER_ID, OTHER_USER_ID] } },
        select: { id: true },
      });
      expect(revenueCat.getSubscriber).toHaveBeenCalledWith(USER_ID);
      expect(revenueCat.getSubscriber).toHaveBeenCalledWith(OTHER_USER_ID);
    });

    it("does not record the event if the sync failed, so RevenueCat's retry is processed", async () => {
      prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);
      revenueCat.getSubscriber.mockRejectedValue(new Error('RevenueCat down'));

      await expect(
        service.handleWebhookEvent(
          body({ id: 'evt-1', type: 'RENEWAL', app_user_id: USER_ID }),
        ),
      ).rejects.toThrow('RevenueCat down');
      expect(prisma.subscriptionEvent.create).not.toHaveBeenCalled();
    });

    it('reports a duplicate when a concurrent delivery already recorded the event', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);
      prisma.subscriptionEvent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.handleWebhookEvent(
        body({ id: 'evt-1', type: 'RENEWAL', app_user_id: USER_ID }),
      );

      expect(result).toEqual({ deduplicated: true, matched: true });
    });
  });

  describe('expireLapsedSubscriptions', () => {
    it('switches off isPro only for flagged users whose subscription has lapsed', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 3 });
      const now = new Date('2026-10-10T00:00:00.000Z');

      await expect(service.expireLapsedSubscriptions(now)).resolves.toBe(3);

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
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
    });
  });
});
