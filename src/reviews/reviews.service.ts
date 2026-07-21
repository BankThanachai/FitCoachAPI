import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(reviewerId: string, createReviewDto: CreateReviewDto) {
    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId },
    });
    if (!reviewer) {
      throw new NotFoundException('Reviewer not found');
    }
    if (reviewer.type !== UserType.Client) {
      throw new BadRequestException('Only clients can write reviews');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: createReviewDto.targetUserId },
    });
    if (!target) {
      throw new NotFoundException('Target user not found');
    }
    if (target.type !== UserType.Trainer) {
      throw new BadRequestException('Reviews can only be written for trainers');
    }

    return this.prisma.review.create({
      data: {
        score: createReviewDto.score,
        comment: createReviewDto.comment,
        reviewerId,
        targetUserId: createReviewDto.targetUserId,
      },
    });
  }

  async findByUser(targetUserId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!target) {
      throw new NotFoundException(`User with id ${targetUserId} not found`);
    }

    const [reviews, aggregate] = await Promise.all([
      this.prisma.review.findMany({
        where: { targetUserId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.aggregate({
        where: { targetUserId },
        _avg: { score: true },
        _count: true,
      }),
    ]);

    return {
      reviews,
      averageScore: aggregate._avg.score
        ? Math.round(aggregate._avg.score * 100) / 100
        : 0,
      totalReviews: aggregate._count,
    };
  }
}
