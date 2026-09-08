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
  UserType,
} from '../../generated/prisma/client';
import { CouponsService } from '../coupons/coupons.service';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../shared/pagination.util';
import { R2Service } from '../shared/r2.service';
import { roundScore } from '../shared/score.util';
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
  ) {}

  /** Adds a computed `profilePhotoUrl` alongside the raw `profilePhotoKey`, null when the user has no photo. */
  private withPhotoUrl<T extends { profilePhotoKey: string | null }>(
    user: T,
  ): T & { profilePhotoUrl: string | null } {
    return {
      ...user,
      profilePhotoUrl: this.r2Service.getPublicUrl(user.profilePhotoKey),
    };
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

      return excludePassword(user);
    } catch (error) {
      throw this.handlePrismaError(error);
    }
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      include: { bankAccounts: true },
    });
    return users.map(excludePassword);
  }

  async searchTrainers(clientId: string, searchTrainerDto: SearchTrainerDto) {
    const page = searchTrainerDto.page ?? 1;
    const pageSize = searchTrainerDto.pageSize ?? 20;
    const where: Prisma.UserWhereInput = {
      type: UserType.Trainer,
      name: searchTrainerDto.name
        ? { contains: searchTrainerDto.name, mode: 'insensitive' }
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
        orderBy: [{ rating: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    const trainerIds = users.map((user) => user.id);

    const [clientTrainerRelations, scoresByTrainer, clientCountsByTrainer] =
      await Promise.all([
        this.prisma.clientTrainer.findMany({
          where: { clientId, trainerId: { in: trainerIds } },
          select: { trainerId: true, status: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.review.groupBy({
          by: ['targetUserId'],
          where: { targetUserId: { in: trainerIds } },
          _avg: { score: true },
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
    const averageScoreByTrainerId = new Map(
      scoresByTrainer.map((row) => [row.targetUserId, row._avg.score]),
    );
    const clientCountByTrainerId = new Map(
      clientCountsByTrainer.map((row) => [row.trainerId, row._count]),
    );

    return paginate(
      users.map((user) => ({
        ...this.withPhotoUrl(excludePassword(user)),
        isFriend: statusByTrainerId.has(user.id),
        clientTrainerStatus: statusByTrainerId.get(user.id) ?? null,
        averageScore: roundScore(averageScoreByTrainerId.get(user.id) ?? null),
        totalClients: clientCountByTrainerId.get(user.id) ?? 0,
      })),
      page,
      pageSize,
      total,
    );
  }

  async findOne(id: string) {
    const user = await this.ensureUserExists(id);

    if (user.type !== UserType.Trainer) {
      return { ...this.withPhotoUrl(excludePassword(user)), workingHours: [] };
    }

    const [workingHours, aggregate, totalClients] = await Promise.all([
      this.workingHoursService.findByUser(id),
      this.prisma.review.aggregate({
        where: { targetUserId: id },
        _avg: { score: true },
      }),
      this.prisma.clientTrainer.count({
        where: { trainerId: id, status: ClientTrainerStatus.Accepted },
      }),
    ]);

    return {
      ...this.withPhotoUrl(excludePassword(user)),
      workingHours,
      averageScore: roundScore(aggregate._avg.score),
      totalClients,
    };
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const existing = await this.ensureUserExists(id);
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
      return excludePassword(user);
    } catch (error) {
      throw this.handlePrismaError(error);
    }
  }

  async remove(id: string) {
    await this.ensureUserExists(id);
    const user = await this.prisma.user.delete({
      where: { id },
      include: { bankAccounts: true },
    });
    return excludePassword(user);
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

  private handlePrismaError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('Email or phone is already in use');
    }
    return error;
  }
}
