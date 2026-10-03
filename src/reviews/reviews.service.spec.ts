import { Test, TestingModule } from '@nestjs/testing';
import { UserType } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from './reviews.service';

const CLIENT_ID = 'client-1';
const TRAINER_ID = 'trainer-1';
const PURCHASE_ID = 'purchase-1';

describe('ReviewsService.create — cached trainer rating', () => {
  let service: ReviewsService;
  let notifications: { create: jest.Mock };
  let tx: {
    $queryRaw: jest.Mock;
    review: { create: jest.Mock; aggregate: jest.Mock };
    user: { update: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    user: { findUnique: jest.Mock };
    coursePurchase: { findUnique: jest.Mock };
    workout: { count: jest.Mock };
  };

  beforeEach(async () => {
    notifications = { create: jest.fn().mockResolvedValue({}) };
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      review: {
        create: jest.fn().mockResolvedValue({ id: 'review-1' }),
        aggregate: jest.fn(),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: CLIENT_ID,
          type: UserType.Client,
          firstName: 'Ann',
          lastName: 'Lee',
        }),
      },
      coursePurchase: {
        findUnique: jest.fn().mockResolvedValue({
          id: PURCHASE_ID,
          clientId: CLIENT_ID,
          review: null,
          course: { trainerId: TRAINER_ID, sessions: 4 },
        }),
      },
      workout: { count: jest.fn().mockResolvedValue(4) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(ReviewsService);
  });

  it('creates the review and refreshes the trainer rating/reviewCount in one transaction', async () => {
    tx.review.aggregate.mockResolvedValue({
      _avg: { score: 4.666666 },
      _count: 3,
    });

    const review = await service.create(CLIENT_ID, {
      purchaseId: PURCHASE_ID,
      score: 5,
    });

    expect(review).toEqual({ id: 'review-1' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.review.create).toHaveBeenCalledWith({
      data: {
        score: 5,
        reviewerId: CLIENT_ID,
        targetUserId: TRAINER_ID,
        purchaseId: PURCHASE_ID,
        isAnonymous: false,
      },
    });
    expect(tx.review.aggregate).toHaveBeenCalledWith({
      where: { targetUserId: TRAINER_ID },
      _avg: { score: true },
      _count: true,
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: TRAINER_ID },
      data: { rating: 4.67, reviewCount: 3 },
    });
  });

  it('locks the trainer row before aggregating, after the review is inserted', async () => {
    const order: string[] = [];
    tx.$queryRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve([]);
    });
    tx.review.create.mockImplementation(() => {
      order.push('create');
      return Promise.resolve({ id: 'review-1' });
    });
    tx.review.aggregate.mockImplementation(() => {
      order.push('aggregate');
      return Promise.resolve({ _avg: { score: 5 }, _count: 1 });
    });

    await service.create(CLIENT_ID, { purchaseId: PURCHASE_ID, score: 5 });

    expect(order).toEqual(['create', 'lock', 'aggregate']);
  });

  it('notifies the trainer after the transaction commits', async () => {
    tx.review.aggregate.mockResolvedValue({ _avg: { score: 5 }, _count: 1 });

    await service.create(CLIENT_ID, { purchaseId: PURCHASE_ID, score: 5 });

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TRAINER_ID, entityId: 'review-1' }),
    );
  });
});
