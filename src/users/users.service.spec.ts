import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserStatus, UserType } from '../../generated/prisma/client';
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
    status: UserStatus.Active,
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
    review: { aggregate: jest.Mock };
    user: { update: jest.Mock; delete: jest.Mock; deleteMany: jest.Mock };
    refreshToken: { updateMany: jest.Mock };
    deviceToken: { deleteMany: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    user: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
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
        aggregate: jest
          .fn()
          .mockResolvedValue({ _avg: { score: 4 }, _count: 1 }),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      deviceToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
      user: {
        findMany: jest.fn().mockResolvedValue([makeUser()]),
        findUnique: jest.fn().mockResolvedValue(makeUser()),
        count: jest.fn().mockResolvedValue(1),
        delete: jest.fn(),
        deleteMany: jest.fn(),
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

  describe('a deactivated (Inactive) user', () => {
    const inactive = () =>
      makeUser({
        id: CLIENT_ID,
        type: UserType.Client,
        status: UserStatus.Inactive,
      });

    it('is still listed by findAll — viewing is unchanged', async () => {
      await service.findAll();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        include: { bankAccounts: true },
      });
    });

    it('can still be viewed with findOne, and its status is visible', async () => {
      prisma.user.findUnique.mockResolvedValue(inactive());

      const result = await service.findOne(CLIENT_ID);

      expect(result).toMatchObject({
        id: CLIENT_ID,
        status: UserStatus.Inactive,
      });
      expect(result).not.toHaveProperty('password');
    });

    it('is the only thing that disappears from trainer search', async () => {
      await service.searchTrainers(CLIENT_ID, {});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: UserType.Trainer,
            status: UserStatus.Active,
          }) as unknown,
        }),
      );
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: UserStatus.Active,
        }) as unknown,
      });
    });

    it('cannot be edited or deactivated again — update and remove treat it as not found', async () => {
      prisma.user.findUnique.mockResolvedValue(inactive());

      await expect(
        service.update(CLIENT_ID, { firstName: 'X' }),
      ).rejects.toThrow(NotFoundException);
      await expect(service.remove(CLIENT_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: CLIENT_ID },
        include: { bankAccounts: true },
      });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('findOne is a 404 only for a user that does not exist at all', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('gone')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (soft delete)', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ id: CLIENT_ID, type: UserType.Client }),
      );
      tx.user.update.mockResolvedValue(
        makeUser({ id: CLIENT_ID, status: UserStatus.Inactive }),
      );
    });

    it('marks the user Inactive instead of deleting the row', async () => {
      await service.remove(CLIENT_ID);

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: CLIENT_ID, status: UserStatus.Active },
        data: {
          status: UserStatus.Inactive,
          deactivatedAt: expect.any(Date) as Date,
        },
        include: { bankAccounts: true },
      });
    });

    it('returns the user, now Inactive and without the password, as DELETE did before', async () => {
      const result = await service.remove(CLIENT_ID);

      expect(result).toMatchObject({
        id: CLIENT_ID,
        status: UserStatus.Inactive,
      });
      expect(result).not.toHaveProperty('password');
    });

    it('never hard-deletes a user, so nothing cascades into their reviews, purchases or chats', async () => {
      await service.remove(CLIENT_ID);

      expect(tx.user.delete).not.toHaveBeenCalled();
      expect(tx.user.deleteMany).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    });

    it('cuts the account off: revokes its refresh tokens and drops its device tokens, in the same transaction', async () => {
      await service.remove(CLIENT_ID);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: CLIENT_ID, revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(tx.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: CLIENT_ID },
      });
    });

    it('leaves the trainers they reviewed alone — their reviews still exist, so ratings do not change', async () => {
      await service.remove(CLIENT_ID);

      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.review.aggregate).not.toHaveBeenCalled();
    });
  });
});
