import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
  }

  async create(userId: string, createBankAccountDto: CreateBankAccountDto) {
    await this.ensureUserExists(userId);

    try {
      return await this.prisma.bankAccount.create({
        data: { ...createBankAccountDto, userId },
      });
    } catch (error) {
      throw this.handlePrismaError(error);
    }
  }

  async findAll(userId: string) {
    await this.ensureUserExists(userId);

    return this.prisma.bankAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id, userId },
    });
    if (!bankAccount) {
      throw new NotFoundException(`Bank account with id ${id} not found`);
    }
    return bankAccount;
  }

  async update(
    userId: string,
    id: string,
    updateBankAccountDto: UpdateBankAccountDto,
  ) {
    await this.findOne(userId, id);
    try {
      return await this.prisma.bankAccount.update({
        where: { id },
        data: updateBankAccountDto,
      });
    } catch (error) {
      throw this.handlePrismaError(error);
    }
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.bankAccount.delete({ where: { id } });
  }

  private handlePrismaError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      // One (bankName, accountNumber) pair can only belong to one bank
      // account row — whether that's this same user trying to re-add an
      // account they (or, more likely, someone else) already registered.
      // Unlike email/phone at registration, an account number isn't
      // treated as a secret here, so the message can say directly what
      // went wrong instead of staying deliberately vague.
      return new ConflictException('This bank account is already registered');
    }
    return error;
  }
}
