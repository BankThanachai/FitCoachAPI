import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  BankAccount,
  Prisma,
  User,
  UserType,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkingHoursService } from '../working-hours/working-hours.service';
import { CreateUserDto } from './dto/create-user.dto';
import { SearchTrainerDto } from './dto/search-trainer.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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
  ) {}

  async create(createUserDto: CreateUserDto) {
    try {
      const hashedPassword = await bcrypt.hash(
        createUserDto.password,
        SALT_ROUNDS,
      );
      const { bankAccounts, ...userData } = createUserDto;
      const user = await this.prisma.user.create({
        data: {
          ...userData,
          password: hashedPassword,
          bankAccounts: bankAccounts ? { create: bankAccounts } : undefined,
        },
        include: { bankAccounts: true },
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

  async searchTrainers(searchTrainerDto: SearchTrainerDto) {
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

    return {
      data: users.map(excludePassword),
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      total,
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { bankAccounts: true },
    });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return excludePassword(user);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    await this.findOne(id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { bankAccounts, ...userData } = updateUserDto;
      const data = userData.password
        ? {
            ...userData,
            password: await bcrypt.hash(userData.password, SALT_ROUNDS),
          }
        : userData;
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
    await this.findOne(id);
    const user = await this.prisma.user.delete({
      where: { id },
      include: { bankAccounts: true },
    });
    return excludePassword(user);
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
