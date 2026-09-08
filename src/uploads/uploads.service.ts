import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UserType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmPortfolioPhotoDto } from './dto/confirm-portfolio-photo.dto';
import { ConfirmProfilePhotoDto } from './dto/confirm-profile-photo.dto';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { R2Service } from './r2.service';

const MAX_PORTFOLIO_PHOTOS = 5;
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
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { profilePhotoKey: dto.key },
    });
    return {
      profilePhotoKey: user.profilePhotoKey,
      profilePhotoUrl: this.r2Service.getPublicUrl(dto.key),
    };
  }

  async presignPortfolioPhoto(trainerId: string, dto: PresignUploadDto) {
    await this.ensureTrainer(trainerId);
    const key = this.buildKey(`users/${trainerId}/portfolio`, dto.contentType);
    const uploadUrl = await this.r2Service.getUploadUrl(key, dto.contentType);
    return { uploadUrl, key };
  }

  async confirmPortfolioPhoto(
    trainerId: string,
    dto: ConfirmPortfolioPhotoDto,
  ) {
    await this.ensureTrainer(trainerId);

    const count = await this.prisma.trainerPortfolioPhoto.count({
      where: { trainerId },
    });
    const existing = await this.prisma.trainerPortfolioPhoto.findUnique({
      where: { trainerId_order: { trainerId, order: dto.order } },
    });
    if (!existing && count >= MAX_PORTFOLIO_PHOTOS) {
      throw new BadRequestException(
        `A trainer can have at most ${MAX_PORTFOLIO_PHOTOS} portfolio photos`,
      );
    }

    const photo = await this.prisma.trainerPortfolioPhoto.upsert({
      where: { trainerId_order: { trainerId, order: dto.order } },
      create: { trainerId, key: dto.key, order: dto.order },
      update: { key: dto.key },
    });
    return { ...photo, url: this.r2Service.getPublicUrl(photo.key) };
  }

  async findPortfolioPhotos(trainerId: string) {
    const photos = await this.prisma.trainerPortfolioPhoto.findMany({
      where: { trainerId },
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
    return this.prisma.trainerPortfolioPhoto.delete({ where: { id } });
  }

  private async ensureTrainer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.type !== UserType.Trainer) {
      throw new BadRequestException('Only trainers can have portfolio photos');
    }
  }
}
