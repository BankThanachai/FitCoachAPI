import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma, User } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 10;

function excludePassword(user: User): Omit<User, 'password'> {
  const { password, ...rest } = user;
  return rest;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    try {
      const hashedPassword = await bcrypt.hash(
        createUserDto.password,
        SALT_ROUNDS,
      );
      const user = await this.prisma.user.create({
        data: { ...createUserDto, password: hashedPassword },
      });
      return excludePassword(user);
    } catch (error) {
      throw this.handlePrismaError(error);
    }
  }

  async findAll() {
    const users = await this.prisma.user.findMany();
    return users.map(excludePassword);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return excludePassword(user);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    await this.findOne(id);
    try {
      const data = updateUserDto.password
        ? {
            ...updateUserDto,
            password: await bcrypt.hash(updateUserDto.password, SALT_ROUNDS),
          }
        : updateUserDto;
      const user = await this.prisma.user.update({ where: { id }, data });
      return excludePassword(user);
    } catch (error) {
      throw this.handlePrismaError(error);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    const user = await this.prisma.user.delete({ where: { id } });
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
