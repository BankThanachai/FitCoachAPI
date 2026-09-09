import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  UserType,
  WorkoutStatus,
} from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeFullName } from '../shared/name.util';
import { paginate } from '../shared/pagination.util';
import { CreateReviewDto } from './dto/create-review.dto';
import { FindReviewsDto } from './dto/find-reviews.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';

const VISIBLE_NAME_CHARS = 3;
const MIN_COMPLETION_RATIO = 0.5;

function maskName(name: string | null): string {
  if (!name) {
    return '***';
  }
  const visible = name.slice(0, VISIBLE_NAME_CHARS);
  const masked = '*'.repeat(Math.max(name.length - VISIBLE_NAME_CHARS, 0));
  return visible + masked;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

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

    const purchase = await this.prisma.coursePurchase.findUnique({
      where: { id: createReviewDto.purchaseId },
      include: { course: true, review: true },
    });
    if (!purchase) {
      throw new NotFoundException('Course purchase not found');
    }
    if (purchase.clientId !== reviewerId) {
      throw new ForbiddenException(
        'Only the client who made this purchase can review it',
      );
    }
    if (purchase.review) {
      throw new BadRequestException('This purchase has already been reviewed');
    }

    const completedCount = await this.prisma.workout.count({
      where: { purchaseId: purchase.id, status: WorkoutStatus.Completed },
    });
    const minCompleted = Math.ceil(
      purchase.course.sessions * MIN_COMPLETION_RATIO,
    );
    if (completedCount < minCompleted) {
      throw new BadRequestException(
        `You can only review a course after completing at least ${minCompleted} of ${purchase.course.sessions} sessions (${MIN_COMPLETION_RATIO * 100}%)`,
      );
    }

    const review = await this.prisma.review.create({
      data: {
        score: createReviewDto.score,
        comment: createReviewDto.comment,
        reviewerId,
        targetUserId: purchase.course.trainerId,
        purchaseId: purchase.id,
        isAnonymous: createReviewDto.isAnonymous ?? false,
      },
    });

    await this.notificationsService.create({
      userId: purchase.course.trainerId,
      type: NotificationType.NewReview,
      title: 'You received a new review',
      body: `${computeFullName(reviewer.firstName, reviewer.lastName) ?? 'A client'} gave you a ${createReviewDto.score}-star review`,
      entityType: 'Review',
      entityId: review.id,
    });

    return review;
  }

  async reply(id: string, trainerId: string, replyReviewDto: ReplyReviewDto) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException(`Review with id ${id} not found`);
    }
    if (review.targetUserId !== trainerId) {
      throw new ForbiddenException(
        'Only the trainer who received this review can reply to it',
      );
    }
    if (review.reply) {
      throw new BadRequestException('This review already has a reply');
    }

    return this.prisma.review.update({
      where: { id },
      data: { reply: replyReviewDto.reply, repliedAt: new Date() },
    });
  }

  /**
   * `averageScore`/`totalReviews` are always computed over every review
   * this user has (via a separate aggregate query), regardless of which
   * page of `reviews` was requested — the summary card shouldn't change
   * depending on how far the client has scrolled.
   */
  async findByUser(targetUserId: string, findReviewsDto: FindReviewsDto) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!target) {
      throw new NotFoundException(`User with id ${targetUserId} not found`);
    }

    const page = findReviewsDto.page ?? 1;
    const pageSize = findReviewsDto.pageSize ?? 20;

    const [reviews, total, aggregate, scoreCounts] = await Promise.all([
      this.prisma.review.findMany({
        where: { targetUserId },
        include: { reviewer: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.review.count({ where: { targetUserId } }),
      this.prisma.review.aggregate({
        where: { targetUserId },
        _avg: { score: true },
        _count: true,
      }),
      this.prisma.review.groupBy({
        by: ['score'],
        where: { targetUserId },
        _count: true,
      }),
    ]);

    const countByScore: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of scoreCounts) {
      countByScore[row.score] = row._count;
    }

    return {
      reviews: paginate(
        reviews.map(({ reviewer, ...review }) => {
          const reviewerFullName = computeFullName(
            reviewer.firstName,
            reviewer.lastName,
          );
          return {
            ...review,
            reviewerName: review.isAnonymous
              ? maskName(reviewerFullName)
              : reviewerFullName,
          };
        }),
        page,
        pageSize,
        total,
      ),
      averageScore: aggregate._avg.score
        ? Math.round(aggregate._avg.score * 100) / 100
        : 0,
      totalReviews: aggregate._count,
      // Total reviews at each star level (1-5), computed over every review
      // this user has — same "not affected by pagination" rule as
      // averageScore/totalReviews above. Powers the rating-breakdown bars
      // on TrainerReviewsScreen.
      countByScore,
    };
  }
}
