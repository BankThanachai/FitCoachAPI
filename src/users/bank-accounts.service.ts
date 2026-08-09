import { Injectable, NotFoundException } from '@nestjs/common';
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

    return this.prisma.bankAccount.create({
      data: { ...createBankAccountDto, userId },
    });
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
    return this.prisma.bankAccount.update({
      where: { id },
      data: updateBankAccountDto,
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.bankAccount.delete({ where: { id } });
  }
}
