import { Test, TestingModule } from '@nestjs/testing';
import { UserType } from '../../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { CouponsService } from '../coupons/coupons.service';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../shared/r2.service';
import { WorkingHoursService } from '../working-hours/working-hours.service';
import { UsersService } from './users.service';

const CLIENT_ID = 'client-1';

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trainer-1',
    password: 'hash',
    type: UserType.Trainer,
    firstName: 'Tom',
    lastName: 'Lee',
    profilePhotoKey: null,
    rating: 4.67,
    reviewCount: 3,
    isPro: false,
    bankAccounts: [],
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    ...overrides,
  };
}

describe('UsersService', () => {
  let service: UsersService;
  let tx: {
    $queryRaw: jest.Mock;
    review: { findMany: jest.Mock; aggregate: jest.Mock };
    user: { delete: jest.Mock; update: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    user: { findMany: jest.Mock; findUnique: jest.Mock; count: jest.Mock };
    review: { groupBy: jest.Mock; aggregate: jest.Mock };
    clientTrainer: {
      findMany: jest.Mock;
      groupBy: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      review: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _avg: { score: 4 }, _count: 1 }),
      },
      user: {
        delete: jest.fn().mockResolvedValue(makeUser({ id: CLIENT_ID })),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
      user: {
        findMany: jest.fn().mockResolvedValue([makeUser()]),
        findUnique: jest.fn().mockResolvedValue(makeUser()),
        count: jest.fn().mockResolvedValue(1),
      },
      review: { groupBy: jest.fn(), aggregate: jest.fn() },
      clientTrainer: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: WorkingHoursService,
          useValue: { findByUser: jest.fn().mockResolvedValue([]) },
        },
        { provide: CouponsService, useValue: {} },
        {
          provide: R2Service,
          useValue: { getPublicUrl: jest.fn().mockReturnValue(null) },
        },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('averageScore comes from the cached User.rating', () => {
    it('searchTrainers returns it without aggregating reviews', async () => {
      const result = await service.searchTrainers(CLIENT_ID, {});

      expect(result.data[0].averageScore).toBe(4.67);
      expect(prisma.review.groupBy).not.toHaveBeenCalled();
    });

    it('searchTrainers sorts Pro, then rating, then review count, then a stable tie-break', async () => {
      await service.searchTrainers(CLIENT_ID, {});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { isPro: 'desc' },
            { rating: 'desc' },
            { reviewCount: 'desc' },
            { firstName: 'asc' },
            { id: 'asc' },
          ],
        }),
      );
    });

    it('findOne returns it for a trainer without aggregating reviews', async () => {
      const result = await service.findOne('trainer-1');

      expect(result).toMatchObject({ averageScore: 4.67 });
      expect(prisma.review.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('refreshes the cached rating of every trainer the deleted client had reviewed, after the user (and so their reviews) are gone', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ id: CLIENT_ID, type: UserType.Client }),
      );
      tx.review.findMany.mockResolvedValue([
        { targetUserId: 'trainer-b' },
        { targetUserId: 'trainer-a' },
      ]);
      const order: string[] = [];
      tx.user.delete.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve(makeUser({ id: CLIENT_ID }));
      });
      tx.user.update.mockImplementation(
        ({ where }: { where: { id: string } }) => {
          order.push(`refresh:${where.id}`);
          return Promise.resolve({});
        },
      );

      await service.remove(CLIENT_ID);

      expect(tx.review.findMany).toHaveBeenCalledWith({
        where: { reviewerId: CLIENT_ID },
        select: { targetUserId: true },
        distinct: ['targetUserId'],
      });
      // Sorted, so concurrent deletions take trainer locks in the same order.
      expect(order).toEqual([
        'delete',
        'refresh:trainer-a',
        'refresh:trainer-b',
      ]);
    });

    it('has nothing to refresh when the deleted user wrote no reviews (e.g. a trainer)', async () => {
      await service.remove('trainer-1');

      expect(tx.user.delete).toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });
});
