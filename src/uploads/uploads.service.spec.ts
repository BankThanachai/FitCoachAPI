import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../shared/r2.service';
import {
  FREE_PORTFOLIO_PHOTO_LIMIT,
  PRO_PORTFOLIO_PHOTO_LIMIT,
} from '../subscriptions/subscription.constants';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { UploadsService } from './uploads.service';

const TRAINER_ID = 'trainer-1';

describe('UploadsService portfolio photo limits', () => {
  let service: UploadsService;
  let subscriptions: { getPortfolioPhotoLimit: jest.Mock };
  let r2: {
    getUploadUrl: jest.Mock;
    getPublicUrl: jest.Mock;
    deleteObject: jest.Mock;
  };
  let prisma: {
    user: { findUnique: jest.Mock };
    trainerPortfolioPhoto: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    subscriptions = {
      getPortfolioPhotoLimit: jest
        .fn()
        .mockResolvedValue(FREE_PORTFOLIO_PHOTO_LIMIT),
    };
    r2 = {
      getUploadUrl: jest.fn().mockResolvedValue('https://upload.example'),
      getPublicUrl: jest.fn((key: string) => `https://cdn.example/${key}`),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: TRAINER_ID, type: UserType.Trainer }),
      },
      trainerPortfolioPhoto: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(({ create }) =>
          Promise.resolve({ id: 'p1', ...create }),
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: R2Service, useValue: r2 },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();

    service = module.get(UploadsService);
  });

  describe('confirmPortfolioPhoto', () => {
    it('lets a free trainer use any slot up to the free limit', async () => {
      await service.confirmPortfolioPhoto(TRAINER_ID, {
        key: 'k',
        order: FREE_PORTFOLIO_PHOTO_LIMIT,
      });

      expect(prisma.trainerPortfolioPhoto.upsert).toHaveBeenCalled();
    });

    it('rejects a free trainer asking for a slot above the free limit with 403 PRO_REQUIRED', async () => {
      const attempt = service.confirmPortfolioPhoto(TRAINER_ID, {
        key: 'k',
        order: FREE_PORTFOLIO_PHOTO_LIMIT + 1,
      });

      await expect(attempt).rejects.toThrow(ForbiddenException);
      await expect(attempt).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 403,
          code: 'PRO_REQUIRED',
        }) as unknown,
      });
      expect(prisma.trainerPortfolioPhoto.upsert).not.toHaveBeenCalled();
    });

    it('lets a Pro trainer use slots up to the Pro limit', async () => {
      subscriptions.getPortfolioPhotoLimit.mockResolvedValue(
        PRO_PORTFOLIO_PHOTO_LIMIT,
      );

      await service.confirmPortfolioPhoto(TRAINER_ID, {
        key: 'k',
        order: PRO_PORTFOLIO_PHOTO_LIMIT,
      });

      expect(subscriptions.getPortfolioPhotoLimit).toHaveBeenCalledWith(
        TRAINER_ID,
      );
      expect(prisma.trainerPortfolioPhoto.upsert).toHaveBeenCalled();
    });

    it('still lets a lapsed-Pro trainer replace a slot inside the free limit, even with leftover photos above it', async () => {
      prisma.trainerPortfolioPhoto.findUnique.mockResolvedValue({
        id: 'p3',
        order: 3,
        key: 'old-key',
      });

      await service.confirmPortfolioPhoto(TRAINER_ID, { key: 'new', order: 3 });

      expect(prisma.trainerPortfolioPhoto.upsert).toHaveBeenCalled();
      expect(r2.deleteObject).toHaveBeenCalledWith('old-key');
    });
  });

  describe('presignPortfolioPhoto', () => {
    it('rejects before issuing an upload URL when the requested slot is above the limit', async () => {
      await expect(
        service.presignPortfolioPhoto(TRAINER_ID, {
          contentType: 'image/jpeg',
          order: 6,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'PRO_REQUIRED',
        }) as unknown,
      });
      expect(r2.getUploadUrl).not.toHaveBeenCalled();
    });

    it('issues an upload URL when the slot is allowed, or when no slot was given', async () => {
      await service.presignPortfolioPhoto(TRAINER_ID, {
        contentType: 'image/jpeg',
        order: 2,
      });
      await service.presignPortfolioPhoto(TRAINER_ID, {
        contentType: 'image/png',
      });

      expect(r2.getUploadUrl).toHaveBeenCalledTimes(2);
    });
  });

  describe('findPortfolioPhotos', () => {
    it("only returns photos within the trainer's current limit", async () => {
      await service.findPortfolioPhotos(TRAINER_ID);

      expect(prisma.trainerPortfolioPhoto.findMany).toHaveBeenCalledWith({
        where: {
          trainerId: TRAINER_ID,
          order: { lte: FREE_PORTFOLIO_PHOTO_LIMIT },
        },
        orderBy: { order: 'asc' },
      });
    });

    it('returns up to the Pro limit while Pro is active', async () => {
      subscriptions.getPortfolioPhotoLimit.mockResolvedValue(
        PRO_PORTFOLIO_PHOTO_LIMIT,
      );

      await service.findPortfolioPhotos(TRAINER_ID);

      expect(prisma.trainerPortfolioPhoto.findMany).toHaveBeenCalledWith({
        where: {
          trainerId: TRAINER_ID,
          order: { lte: PRO_PORTFOLIO_PHOTO_LIMIT },
        },
        orderBy: { order: 'asc' },
      });
    });
  });
});
