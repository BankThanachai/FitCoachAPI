import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CouponsService } from '../coupons/coupons.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrainerCoursesService } from './trainer-courses.service';

const TRAINER_ID = 'trainer-1';
const COURSE_ID = 'course-1';

describe('TrainerCoursesService.remove', () => {
  let service: TrainerCoursesService;
  let calls: string[];
  let prisma: {
    $transaction: jest.Mock;
    trainerCourse: { findFirst: jest.Mock };
  };
  let tx: {
    $queryRaw: jest.Mock;
    trainerCourse: { delete: jest.Mock };
    review: { aggregate: jest.Mock };
    user: { update: jest.Mock };
  };

  beforeEach(async () => {
    calls = [];
    tx = {
      $queryRaw: jest.fn(() => {
        calls.push('lock');
        return Promise.resolve([]);
      }),
      trainerCourse: {
        delete: jest.fn(() => {
          calls.push('delete');
          return Promise.resolve({ id: COURSE_ID });
        }),
      },
      review: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _avg: { score: 4 }, _count: 1 }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
      trainerCourse: {
        findFirst: jest.fn().mockResolvedValue({ id: COURSE_ID }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainerCoursesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CouponsService, useValue: {} },
      ],
    }).compile();

    service = module.get(TrainerCoursesService);
  });

  it("deletes the course and refreshes the trainer's cached rating in the same transaction (the delete cascades into their reviews)", async () => {
    const result = await service.remove(TRAINER_ID, COURSE_ID);

    expect(result).toEqual({ id: COURSE_ID });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['delete', 'lock']);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: TRAINER_ID },
      data: { rating: 4, reviewCount: 1 },
    });
  });

  it("does not touch anything for a course that isn't the trainer's", async () => {
    prisma.trainerCourse.findFirst.mockResolvedValue(null);

    await expect(service.remove(TRAINER_ID, COURSE_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
