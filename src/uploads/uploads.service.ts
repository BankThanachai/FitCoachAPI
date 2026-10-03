import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UserType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../shared/r2.service';
import { ProRequiredException } from '../subscriptions/pro-required.exception';
import {
  FREE_PORTFOLIO_PHOTO_LIMIT,
  PRO_PORTFOLIO_PHOTO_LIMIT,
} from '../subscriptions/subscription.constants';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ConfirmPortfolioPhotoDto } from './dto/confirm-portfolio-photo.dto';
import { ConfirmProfilePhotoDto } from './dto/confirm-profile-photo.dto';
import { PresignPortfolioPhotoDto } from './dto/presign-portfolio-photo.dto';
import { PresignUploadDto } from './dto/presign-upload.dto';

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  private buildKey(prefix: string, contentType: string) {
    const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
    return `${prefix}/${randomUUID()}.${extension}`;
  }

  async presignProfilePhoto(userId: string, dto: PresignUploadDto) {
    const key = this.buildKey(`users/${userId}/profile`, dto.contentType);
    const uploadUrl = await this.r2Service.getUploadUrl(key, dto.contentType);
    return { uploadUrl, key };
  }

  async confirmProfilePhoto(userId: string, dto: ConfirmProfilePhotoDto) {
    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profilePhotoKey: true },
    });

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { profilePhotoKey: dto.key },
    });

    if (previous?.profilePhotoKey && previous.profilePhotoKey !== dto.key) {
      await this.r2Service.deleteObject(previous.profilePhotoKey);
    }

    return {
      profilePhotoKey: user.profilePhotoKey,
      profilePhotoUrl: this.r2Service.getPublicUrl(dto.key),
    };
  }

  async presignPortfolioPhoto(
    trainerId: string,
    dto: PresignPortfolioPhotoDto,
  ) {
    await this.ensureTrainer(trainerId);
    if (dto.order !== undefined) {
      await this.ensureSlotAllowed(trainerId, dto.order);
    }
    const key = this.buildKey(`users/${trainerId}/portfolio`, dto.contentType);
    const uploadUrl = await this.r2Service.getUploadUrl(key, dto.contentType);
    return { uploadUrl, key };
  }

  async confirmPortfolioPhoto(
    trainerId: string,
    dto: ConfirmPortfolioPhotoDto,
  ) {
    await this.ensureTrainer(trainerId);
    await this.ensureSlotAllowed(trainerId, dto.order);

    const existing = await this.prisma.trainerPortfolioPhoto.findUnique({
      where: { trainerId_order: { trainerId, order: dto.order } },
    });

    const photo = await this.prisma.trainerPortfolioPhoto.upsert({
      where: { trainerId_order: { trainerId, order: dto.order } },
      create: { trainerId, key: dto.key, order: dto.order },
      update: { key: dto.key },
    });

    if (existing && existing.key !== dto.key) {
      await this.r2Service.deleteObject(existing.key);
    }

    return { ...photo, url: this.r2Service.getPublicUrl(photo.key) };
  }

  async findPortfolioPhotos(trainerId: string) {
    // A trainer whose Pro lapsed may still have photos in slots above the
    // free limit. They stay stored (and come back on re-subscribing) but
    // aren't shown while the account is on the free limit.
    const limit =
      await this.subscriptionsService.getPortfolioPhotoLimit(trainerId);
    const photos = await this.prisma.trainerPortfolioPhoto.findMany({
      where: { trainerId, order: { lte: limit } },
      orderBy: { order: 'asc' },
    });
    return photos.map((photo) => ({
      ...photo,
      url: this.r2Service.getPublicUrl(photo.key),
    }));
  }

  async removePortfolioPhoto(trainerId: string, id: string) {
    const photo = await this.prisma.trainerPortfolioPhoto.findUnique({
      where: { id },
    });
    if (!photo) {
      throw new NotFoundException(`Portfolio photo with id ${id} not found`);
    }
    if (photo.trainerId !== trainerId) {
      throw new ForbiddenException('This portfolio photo does not belong to you');
    }
    const deleted = await this.prisma.trainerPortfolioPhoto.delete({
      where: { id },
    });
    await this.r2Service.deleteObject(deleted.key);
    return deleted;
  }

  // The number of slots a trainer may use depends on whether Pro is active
  // right now (Subscription.expiresAt, not the User.isPro flag, which can lag
  // a missed webhook). Slots are unique per (trainerId, order), so capping
  // which `order` is allowed also caps how many photos can be shown — and,
  // unlike counting photos, still lets a lapsed-Pro trainer who has leftover
  // photos above the limit replace or fill a slot inside it.
  private async ensureSlotAllowed(trainerId: string, order: number) {
    const limit =
      await this.subscriptionsService.getPortfolioPhotoLimit(trainerId);
    if (order > limit) {
      throw new ProRequiredException(
        `Free accounts can have up to ${FREE_PORTFOLIO_PHOTO_LIMIT} portfolio photos. Upgrade to FitWork Pro for up to ${PRO_PORTFOLIO_PHOTO_LIMIT}.`,
      );
    }
  }

  private async ensureTrainer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.type !== UserType.Trainer) {
      throw new BadRequestException('Only trainers can have portfolio photos');
    }
  }
}
