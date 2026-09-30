import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { UserType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { ResendService } from './resend.service';
import { SMS_PROVIDER } from './sms/sms-provider.interface';

const USER_ID = 'user-1';
const EMAIL = 'client@example.com';
const PHONE = '0812345678';

function makeUser(
  overrides: Partial<{
    emailVerifiedAt: Date | null;
    phoneVerifiedAt: Date | null;
  }> = {},
) {
  return {
    id: USER_ID,
    email: EMAIL,
    phone: PHONE,
    password: 'hashed',
    type: UserType.Client,
    emailVerifiedAt:
      overrides.emailVerifiedAt === undefined
        ? null
        : overrides.emailVerifiedAt,
    phoneVerifiedAt:
      overrides.phoneVerifiedAt === undefined
        ? null
        : overrides.phoneVerifiedAt,
  };
}

describe('AuthService', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  });

  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    emailOtp: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    phoneOtp: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    refreshToken: { create: jest.Mock };
    deviceToken: { upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let resendService: { sendOtpEmail: jest.Mock };
  let smsProvider: { sendOtpSms: jest.Mock };
  let fakeTx: typeof prisma;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      emailOtp: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      phoneOtp: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: { create: jest.fn() },
      deviceToken: { upsert: jest.fn() },
      $transaction: jest.fn((arg: unknown) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return (arg as (tx: unknown) => unknown)(fakeTx);
      }),
    };
    fakeTx = prisma;
    resendService = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };
    smsProvider = { sendOtpSms: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: ResendService, useValue: resendService },
        { provide: SMS_PROVIDER, useValue: smsProvider },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('signed') },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login', () => {
    it('issues tokens on a correct password even when email/phone are unverified, flagging both as false', async () => {
      const user = makeUser({ emailVerifiedAt: null, phoneVerifiedAt: null });
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        password: await bcrypt.hash('correct-password', 4),
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login({
        identifier: EMAIL,
        password: 'correct-password',
      });

      expect(result).toMatchObject({
        accessToken: 'signed',
        emailVerified: false,
        phoneVerified: false,
      });
      expect(result).toHaveProperty('refreshToken');
    });

    it('reports emailVerified/phoneVerified independently once each is set', async () => {
      const user = makeUser({
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: null,
      });
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        password: await bcrypt.hash('correct-password', 4),
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login({
        identifier: EMAIL,
        password: 'correct-password',
      });

      expect(result).toMatchObject({
        emailVerified: true,
        phoneVerified: false,
      });
    });

    it('rejects with generic "Invalid credentials" on a wrong password, never revealing email', async () => {
      const user = makeUser({ emailVerifiedAt: null });
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        password: await bcrypt.hash('correct-password', 4),
      });

      await expect(
        service.login({ identifier: user.phone, password: 'wrong-password' }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('resolves an identifier without "@" as a phone lookup', async () => {
      const user = makeUser({ emailVerifiedAt: new Date() });
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        password: await bcrypt.hash('correct-password', 4),
      });
      prisma.refreshToken.create.mockResolvedValue({});

      await service.login({
        identifier: user.phone,
        password: 'correct-password',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { phone: user.phone },
      });
    });
  });

  describe('sendEmailOtp', () => {
    it('invalidates prior unconsumed OTPs and emails a fresh code', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.emailOtp.findFirst.mockResolvedValue(null);

      await service.sendEmailOtp(USER_ID);

      expect(prisma.emailOtp.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, consumedAt: null },
        data: { consumedAt: expect.any(Date) as Date },
      });
      expect(prisma.emailOtp.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: USER_ID }) as unknown,
        }),
      );
      expect(resendService.sendOtpEmail).toHaveBeenCalledWith(
        EMAIL,
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('rejects resending within the cooldown window', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.emailOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        createdAt: new Date(),
      });

      await expect(service.sendEmailOtp(USER_ID)).rejects.toThrow(
        'Please wait before requesting another code',
      );
      expect(resendService.sendOtpEmail).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmailOtp', () => {
    it('verifies the user on a correct, unexpired code', async () => {
      const code = '123456';
      const hashed = service['hashToken'](code);
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.emailOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: hashed,
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      });

      const result = await service.verifyEmailOtp(EMAIL, code);

      expect(result).toEqual({ verified: true });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { emailVerifiedAt: expect.any(Date) as Date },
        }),
      );
    });

    it('rejects a wrong code and increments attempts', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.emailOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('654321'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      });

      await expect(service.verifyEmailOtp(EMAIL, '000000')).rejects.toThrow(
        'Invalid or expired code',
      );
      expect(prisma.emailOtp.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('rejects an expired code', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.emailOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('123456'),
        expiresAt: new Date(Date.now() - 1000),
        attempts: 0,
      });

      await expect(service.verifyEmailOtp(EMAIL, '123456')).rejects.toThrow(
        'Invalid or expired code',
      );
    });

    it('rejects once the attempt cap is exceeded, with the same generic message', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.emailOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('123456'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 5,
      });

      await expect(service.verifyEmailOtp(EMAIL, '123456')).rejects.toThrow(
        'Invalid or expired code',
      );
    });

    it('rejects an unregistered email with the same generic message as a wrong code', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyEmailOtp('nobody@example.com', '123456'),
      ).rejects.toThrow('Invalid or expired code');
    });
  });

  describe('sendPhoneOtp', () => {
    it('invalidates prior unconsumed OTPs and texts a fresh code', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.phoneOtp.findFirst.mockResolvedValue(null);

      await service.sendPhoneOtp(USER_ID);

      expect(prisma.phoneOtp.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, consumedAt: null },
        data: { consumedAt: expect.any(Date) as Date },
      });
      expect(prisma.phoneOtp.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: USER_ID }) as unknown,
        }),
      );
      expect(smsProvider.sendOtpSms).toHaveBeenCalledWith(
        PHONE,
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('rejects resending within the cooldown window', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.phoneOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        createdAt: new Date(),
      });

      await expect(service.sendPhoneOtp(USER_ID)).rejects.toThrow(
        'Please wait before requesting another code',
      );
      expect(smsProvider.sendOtpSms).not.toHaveBeenCalled();
    });
  });

  describe('verifyPhoneOtp', () => {
    it('verifies the user on a correct, unexpired code', async () => {
      const code = '123456';
      const hashed = service['hashToken'](code);
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.phoneOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: hashed,
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      });

      const result = await service.verifyPhoneOtp(PHONE, code);

      expect(result).toEqual({ verified: true });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { phoneVerifiedAt: expect.any(Date) as Date },
        }),
      );
    });

    it('rejects a wrong code and increments attempts', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.phoneOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('654321'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      });

      await expect(service.verifyPhoneOtp(PHONE, '000000')).rejects.toThrow(
        'Invalid or expired code',
      );
      expect(prisma.phoneOtp.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('rejects an expired code', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.phoneOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('123456'),
        expiresAt: new Date(Date.now() - 1000),
        attempts: 0,
      });

      await expect(service.verifyPhoneOtp(PHONE, '123456')).rejects.toThrow(
        'Invalid or expired code',
      );
    });

    it('rejects once the attempt cap is exceeded, with the same generic message', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.phoneOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('123456'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 5,
      });

      await expect(service.verifyPhoneOtp(PHONE, '123456')).rejects.toThrow(
        'Invalid or expired code',
      );
    });

    it('rejects an unregistered phone with the same generic message as a wrong code', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyPhoneOtp('0899999999', '123456'),
      ).rejects.toThrow('Invalid or expired code');
    });
  });
});
