import { Test, TestingModule } from '@nestjs/testing';
import { WorkoutStatus } from '../../generated/prisma/client';
import { CoursePurchasesService } from '../course-purchases/course-purchases.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../shared/r2.service';
import { WorkoutsService } from './workouts.service';

const TRAINER_ID = 'trainer-1';

function makeWorkout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workout-1',
    trainerId: TRAINER_ID,
    clientId: 'client-1',
    purchaseId: 'purchase-1',
    status: WorkoutStatus.PendingApproval,
    date: new Date('2026-10-03T00:00:00.000Z'),
    fromTime: new Date('1970-01-01T09:00:00.000Z'),
    toTime: new Date('1970-01-01T10:00:00.000Z'),
    trainer: { id: TRAINER_ID, firstName: 'Tom', lastName: 'Coach' },
    client: {
      id: 'client-1',
      firstName: 'Ann',
      lastName: 'Lee',
      profilePhotoKey: 'profiles/client-1.jpg',
    },
    exercises: [],
    ...overrides,
  };
}

describe('WorkoutsService.findByTrainer', () => {
  let service: WorkoutsService;
  let prisma: { workout: { findMany: jest.Mock; count: jest.Mock } };
  let r2: { getPublicUrl: jest.Mock };

  beforeEach(async () => {
    prisma = {
      workout: {
        findMany: jest.fn().mockResolvedValue([makeWorkout()]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    r2 = {
      getPublicUrl: jest.fn((key: string | null) =>
        key === null ? null : `https://cdn.test/${key}`,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: CoursePurchasesService, useValue: {} },
        { provide: R2Service, useValue: r2 },
      ],
    }).compile();

    service = module.get(WorkoutsService);
  });

  const whereOf = (mock: jest.Mock) =>
    (mock.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;

  describe('status filter', () => {
    it('filters to every status in the list', async () => {
      const statuses = [
        WorkoutStatus.PendingApproval,
        WorkoutStatus.TrainerApproved,
        WorkoutStatus.TrainerSubmitted,
      ];
      await service.findByTrainer(
        TRAINER_ID,
        1,
        20,
        undefined,
        undefined,
        undefined,
        undefined,
        statuses,
      );

      expect(whereOf(prisma.workout.findMany)).toMatchObject({
        trainerId: TRAINER_ID,
        status: { in: statuses },
      });
    });

    it('works with a single status', async () => {
      await service.findByTrainer(
        TRAINER_ID,
        1,
        20,
        undefined,
        undefined,
        undefined,
        undefined,
        [WorkoutStatus.PendingApproval],
      );

      expect(whereOf(prisma.workout.findMany).status).toEqual({
        in: [WorkoutStatus.PendingApproval],
      });
    });

    it.each([[undefined], [[]]])(
      'does not filter by status when given %j',
      async (statuses) => {
        await service.findByTrainer(
          TRAINER_ID,
          1,
          20,
          undefined,
          undefined,
          undefined,
          undefined,
          statuses,
        );

        expect(whereOf(prisma.workout.findMany).status).toBeUndefined();
      },
    );

    it('counts total with the exact same where as the page query', async () => {
      await service.findByTrainer(
        TRAINER_ID,
        1,
        20,
        '2026-10-03',
        undefined,
        undefined,
        'ann',
        [WorkoutStatus.PendingApproval, WorkoutStatus.TrainerApproved],
      );

      expect(whereOf(prisma.workout.count)).toEqual(
        whereOf(prisma.workout.findMany),
      );
      expect(whereOf(prisma.workout.count)).toMatchObject({
        status: {
          in: [WorkoutStatus.PendingApproval, WorkoutStatus.TrainerApproved],
        },
      });
    });
  });

  describe('unchanged behaviour', () => {
    it('keeps ordering, pagination and the other filters', async () => {
      await service.findByTrainer(
        TRAINER_ID,
        3,
        10,
        undefined,
        '2026-10-01',
        '2026-10-31',
        'ann',
        [WorkoutStatus.Completed],
      );

      expect(prisma.workout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ date: 'desc' }, { fromTime: 'asc' }],
          skip: 20,
          take: 10,
        }),
      );
      expect(whereOf(prisma.workout.findMany)).toMatchObject({
        trainerId: TRAINER_ID,
        date: {
          gte: new Date('2026-10-01'),
          lte: new Date('2026-10-31'),
        },
        client: {
          OR: [
            { firstName: { contains: 'ann', mode: 'insensitive' } },
            { lastName: { contains: 'ann', mode: 'insensitive' } },
          ],
        },
      });
    });

    it('returns the paginated envelope', async () => {
      prisma.workout.count.mockResolvedValue(45);
      const result = await service.findByTrainer(TRAINER_ID, 2, 20);

      expect(result).toMatchObject({
        page: 2,
        pageSize: 20,
        total: 45,
        totalPages: 3,
      });
    });
  });

  describe('client profile photo', () => {
    it('selects profilePhotoKey for the client', async () => {
      await service.findByTrainer(TRAINER_ID, 1, 20);

      const [{ include }] = prisma.workout.findMany.mock.calls[0] as [
        { include: { client: { select: Record<string, boolean> } } },
      ];
      expect(include.client.select.profilePhotoKey).toBe(true);
    });

    it('exposes client.profilePhotoUrl and never the raw key', async () => {
      const { data } = await service.findByTrainer(TRAINER_ID, 1, 20);

      expect(data[0].client).toEqual({
        id: 'client-1',
        firstName: 'Ann',
        lastName: 'Lee',
        name: 'Ann Lee',
        profilePhotoUrl: 'https://cdn.test/profiles/client-1.jpg',
      });
      expect(data[0].client).not.toHaveProperty('profilePhotoKey');
      expect(r2.getPublicUrl).toHaveBeenCalledWith('profiles/client-1.jpg');
    });

    it('returns profilePhotoUrl: null when the client has no photo', async () => {
      prisma.workout.findMany.mockResolvedValue([
        makeWorkout({
          client: {
            id: 'client-1',
            firstName: 'Ann',
            lastName: 'Lee',
            profilePhotoKey: null,
          },
        }),
      ]);

      const { data } = await service.findByTrainer(TRAINER_ID, 1, 20);

      expect(data[0].client).toMatchObject({ profilePhotoUrl: null });
      expect(data[0].client).not.toHaveProperty('profilePhotoKey');
    });

    it('keeps the rest of the workout shape intact', async () => {
      const { data } = await service.findByTrainer(TRAINER_ID, 1, 20);

      expect(data[0]).toMatchObject({
        id: 'workout-1',
        status: WorkoutStatus.PendingApproval,
        date: '2026-10-03',
        fromTime: '09:00',
        toTime: '10:00',
        trainer: { id: TRAINER_ID, name: 'Tom Coach' },
      });
    });
  });
});
