import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BankAccountsService } from './bank-accounts.service';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const ACCOUNT_ID = 'account-1';

function makeDuplicateError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('BankAccountsService', () => {
  let service: BankAccountsService;
  let prisma: {
    user: { findUnique: jest.Mock };
    bankAccount: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ID }) },
      bankAccount: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankAccountsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BankAccountsService);
  });

  describe('create', () => {
    it('creates a bank account for the owning user', async () => {
      const dto = { bankName: 'KBank', accountNumber: '123456' };
      prisma.bankAccount.create.mockResolvedValue({ id: ACCOUNT_ID, ...dto });

      const result = await service.create(USER_ID, dto);

      expect(prisma.bankAccount.create).toHaveBeenCalledWith({
        data: { ...dto, userId: USER_ID },
      });
      expect(result).toEqual({ id: ACCOUNT_ID, ...dto });
    });

    it('rejects with 409 when the same bankName + accountNumber already exists', async () => {
      prisma.bankAccount.create.mockRejectedValue(makeDuplicateError());

      await expect(
        service.create(USER_ID, { bankName: 'KBank', accountNumber: '123456' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws 404 when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create(USER_ID, { bankName: 'KBank', accountNumber: '123456' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.bankAccount.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it("returns 404, not another user's account, when the id belongs to someone else", async () => {
      // findFirst is scoped to { id, userId } — a mismatched owner looks
      // identical to a nonexistent id, so this never leaks whether the id
      // exists at all.
      prisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(service.findOne(OTHER_USER_ID, ACCOUNT_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.bankAccount.findFirst).toHaveBeenCalledWith({
        where: { id: ACCOUNT_ID, userId: OTHER_USER_ID },
      });
    });
  });

  describe('update', () => {
    it('rejects with 409 when updating into a bankName + accountNumber someone else already has', async () => {
      prisma.bankAccount.findFirst.mockResolvedValue({
        id: ACCOUNT_ID,
        userId: USER_ID,
        bankName: 'KBank',
        accountNumber: '111111',
      });
      prisma.bankAccount.update.mockRejectedValue(makeDuplicateError());

      await expect(
        service.update(USER_ID, ACCOUNT_ID, { accountNumber: '123456' }),
      ).rejects.toThrow(ConflictException);
    });

    it("throws 404 before attempting the update when the account is not the caller's", async () => {
      prisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.update(OTHER_USER_ID, ACCOUNT_ID, { accountNumber: '123456' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.bankAccount.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it("throws 404 when the account is not the caller's, without deleting anything", async () => {
      prisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(service.remove(OTHER_USER_ID, ACCOUNT_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.bankAccount.delete).not.toHaveBeenCalled();
    });
  });
});
