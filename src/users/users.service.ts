import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  BankAccount,
  ClientTrainerStatus,
  Prisma,
  User,
  UserStatus,
  UserType,
} from '../../generated/prisma/client';
import { AuthService } from '../auth/auth.service';
import { CouponsService } from '../coupons/coupons.service';
import { PrismaService } from '../prisma/prisma.service';
import { withFullName } from '../shared/name.util';
import { paginate } from '../shared/pagination.util';
import { R2Service } from '../shared/r2.service';
import { WorkingHoursService } from '../working-hours/working-hours.service';
import { CreateUserDto } from './dto/create-user.dto';
import { SearchTrainerDto } from './dto/search-trainer.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const TRIAL_COURSE_SESSIONS = 1;
const TRIAL_COURSE_PRICE = 0;

const SALT_ROUNDS = 10;

type UserWithBankAccounts = User & { bankAccounts: BankAccount[] };

function excludePassword(
  user: UserWithBankAccounts,
): Omit<UserWithBankAccounts, 'password'> {
  const { password, ...rest } = user;
  return rest;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workingHoursService: WorkingHoursService,
    private readonly couponsService: CouponsService,
    private readonly r2Service: R2Service,
    private readonly authService: AuthService,
  ) {}

  /** Adds computed `profilePhotoUrl` and `name` (firstName + lastName) fields to a user. */
  private withComputedFields<
    T extends { profilePhotoKey: string | null; firstName: string | null; lastName: string | null },
  >(user: T) {
    return withFullName({
      ...user,
      profilePhotoUrl: this.r2Service.getPublicUrl(user.profilePhotoKey),
    });
  }

  async create(createUserDto: CreateUserDto) {
    try {
      const hashedPassword = await bcrypt.hash(
        createUserDto.password,
        SALT_ROUNDS,
      );
      const { bankAccounts, ...userData } = createUserDto;
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            ...userData,
            birthDate: userData.birthDate
              ? new Date(userData.birthDate)
              : undefined,
            password: hashedPassword,
            bankAccounts: bankAccounts ? { create: bankAccounts } : undefined,
          },
          include: { bankAccounts: true },
        });

        if (created.type === UserType.Trainer) {
          await tx.trainerCourse.create({
            data: {
              trainerId: created.id,
              sessions: TRIAL_COURSE_SESSIONS,
              price: TRIAL_COURSE_PRICE,
              isTrial: true,
            },
          });
        }

        if (created.type === UserType.Client) {
          await this.couponsService.issueTrialCoupon(tx, created.id);
        }

        return created;
      });

      if (user.type === UserType.Trainer) {
        await this.workingHoursService.create(user.id, {});
      }

      await this.authService.sendEmailOtp(user.id);

      return this.withComputedFields(excludePassword(user));
    } catch (error) {
      throw this.handlePrismaError(error);
    }
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      include: { bankAccounts: true },
    });
    return users.map((user) => this.withComputedFields(excludePassword(user)));
  }

  async searchTrainers(clientId: string, searchTrainerDto: SearchTrainerDto) {
    const page = searchTrainerDto.page ?? 1;
    const pageSize = searchTrainerDto.pageSize ?? 20;
    const where: Prisma.UserWhereInput = {
      type: UserType.Trainer,
      status: UserStatus.Active,
      firstName: searchTrainerDto.firstName
        ? { contains: searchTrainerDto.firstName, mode: 'insensitive' }
        : undefined,
      lastName: searchTrainerDto.lastName
        ? { contains: searchTrainerDto.lastName, mode: 'insensitive' }
        : undefined,
      gender: searchTrainerDto.gender,
      province: searchTrainerDto.province,
      district: searchTrainerDto.district,
      subDistrict: searchTrainerDto.subDistrict,
      acceptsPartnerWork: searchTrainerDto.acceptsPartnerWork,
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { bankAccounts: true },
        // Pro trainers first, then best-rated, then most-reviewed. firstName
        // and id are only tie-breakers: with them the order is total, so
        // pagination can't repeat or skip a trainer between pages.
        orderBy: [
          { isPro: 'desc' },
          { rating: 'desc' },
          { reviewCount: 'desc' },
          { firstName: 'asc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    const trainerIds = users.map((user) => user.id);

    const [clientTrainerRelations, clientCountsByTrainer] = await Promise.all([
      this.prisma.clientTrainer.findMany({
        where: { clientId, trainerId: { in: trainerIds } },
        select: { trainerId: true, status: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.clientTrainer.groupBy({
        by: ['trainerId'],
        where: {
          trainerId: { in: trainerIds },
          status: ClientTrainerStatus.Accepted,
        },
        _count: true,
      }),
    ]);
    const statusByTrainerId = new Map<string, ClientTrainerStatus>();
    for (const relation of clientTrainerRelations) {
      if (!statusByTrainerId.has(relation.trainerId)) {
        statusByTrainerId.set(relation.trainerId, relation.status);
      }
    }
    const clientCountByTrainerId = new Map(
      clientCountsByTrainer.map((row) => [row.trainerId, row._count]),
    );

    return paginate(
      users.map((user) => ({
        ...this.withComputedFields(excludePassword(user)),
        isFriend: statusByTrainerId.has(user.id),
        clientTrainerStatus: statusByTrainerId.get(user.id) ?? null,
        // Read from the cached column (kept current by refreshTrainerRating)
        // rather than aggregating reviews per request.
        averageScore: user.rating,
        totalClients: clientCountByTrainerId.get(user.id) ?? 0,
      })),
      page,
      pageSize,
      total,
    );
  }

  async findOne(id: string) {
    const user = await this.ensureUserExists(id);
    // Mobile gates screens on these booleans (e.g. VerifyGateScreen) — it
    // doesn't read emailVerifiedAt/phoneVerifiedAt (raw timestamp or null)
    // directly, so both need to be present here as `true`/`false`. This
    // mirrors what /auth/login already returns after a fresh login; findOne
    // is what refreshes that status afterwards (e.g. right after verifying
    // an OTP), so it needs to report it too.
    const verification = {
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
    };

    if (user.type !== UserType.Trainer) {
      return {
        ...this.withComputedFields(excludePassword(user)),
        ...verification,
        workingHours: [],
      };
    }

    const [workingHours, totalClients] = await Promise.all([
      this.workingHoursService.findByUser(id),
      this.prisma.clientTrainer.count({
        where: { trainerId: id, status: ClientTrainerStatus.Accepted },
      }),
    ]);

    return {
      ...this.withComputedFields(excludePassword(user)),
      ...verification,
      workingHours,
      averageScore: user.rating,
      totalClients,
    };
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const existing = await this.ensureActiveUserExists(id);
    if (
      updateUserDto.acceptsPartnerWork !== undefined &&
      existing.type !== UserType.Trainer
    ) {
      throw new BadRequestException(
        'Only trainers can toggle acceptsPartnerWork',
      );
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { bankAccounts, ...userData } = updateUserDto;
      const data = {
        ...userData,
        birthDate: userData.birthDate
          ? new Date(userData.birthDate)
          : undefined,
        password: userData.password
          ? await bcrypt.hash(userData.password, SALT_ROUNDS)
          : undefined,
      };
      const user = await this.prisma.user.update({
        where: { id },
        data,
        include: { bankAccounts: true },
      });
      return this.withComputedFields(excludePassword(user));
    } catch (error) {
      throw this.handlePrismaError(error);
    }
  }

  // Soft delete — users are never hard-deleted. The row and everything that
  // points at it (reviews, workouts, purchases, chats, ...) stays and can still
  // be viewed; the account is just marked Inactive. That stops it logging in,
  // takes the trainer out of search, stops clients buying more of their courses,
  // and frees its email/phone for a new registration (they're only unique among
  // Active users). Its refresh tokens are revoked and its device tokens dropped
  // so it stops being reachable, and JwtStrategy rejects any access token it had
  // already been issued, since it re-checks the status per request.
  async remove(id: string) {
    await this.ensureActiveUserExists(id);
    const now = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.deviceToken.deleteMany({ where: { userId: id } });
      return tx.user.update({
        where: { id, status: UserStatus.Active },
        data: { status: UserStatus.Inactive, deactivatedAt: now },
        include: { bankAccounts: true },
      });
    });
    return this.withComputedFields(excludePassword(user));
  }

  private async ensureUserExists(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { bankAccounts: true },
    });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return user;
  }

  // For changes: a deactivated account can still be viewed (findOne) but not
  // edited, and can't be deactivated a second time — it counts as not found.
  private async ensureActiveUserExists(id: string) {
    const user = await this.ensureUserExists(id);
    if (user.status !== UserStatus.Active) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return user;
  }

  private handlePrismaError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      // Deliberately doesn't say "already in use" or name which field
      // (email vs phone) conflicted — that would let someone probe a list
      // of emails/phones against this endpoint to find out which ones are
      // registered. The client can't recover from this any differently
      // than from an unclear-cause failure, so nothing is lost by keeping
      // it vague.
      return new ConflictException(
        'Unable to register with the provided information',
      );
    }
    return error;
  }
}
