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
    failedLoginAttempts: number;
    lockedUntil: Date | null;
    emailOtpLockedUntil: Date | null;
    phoneOtpLockedUntil: Date | null;
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
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    lockedUntil:
      overrides.lockedUntil === undefined ? null : overrides.lockedUntil,
    emailOtpLockedUntil:
      overrides.emailOtpLockedUntil === undefined
        ? null
        : overrides.emailOtpLockedUntil,
    phoneOtpLockedUntil:
      overrides.phoneOtpLockedUntil === undefined
        ? null
        : overrides.phoneOtpLockedUntil,
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
        // registerFailedOtpAttempt reads the post-increment `attempts` off
        // this call's return value (mirrors Prisma's real atomic
        // `{ increment: 1 }` behavior) — tests that care about a specific
        // resulting count override this per-call.
        update: jest.fn().mockResolvedValue({ attempts: 1 }),
      },
      phoneOtp: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ attempts: 1 }),
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

    it('increments failedLoginAttempts on a wrong password without locking below the threshold', async () => {
      const user = makeUser({ failedLoginAttempts: 1 });
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        password: await bcrypt.hash('correct-password', 4),
      });

      await expect(
        service.login({ identifier: EMAIL, password: 'wrong-password' }),
      ).rejects.toThrow('Invalid credentials');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { failedLoginAttempts: 2 },
      });
    });

    it('locks the account for 5 minutes on the 3rd consecutive wrong password, returning 429 with retryAfterSeconds', async () => {
      const user = makeUser({ failedLoginAttempts: 2 });
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        password: await bcrypt.hash('correct-password', 4),
      });

      await expect(
        service.login({ identifier: EMAIL, password: 'wrong-password' }),
      ).rejects.toMatchObject({
        status: 429,
        response: expect.objectContaining({
          statusCode: 429,
          retryAfterSeconds: expect.any(Number) as number,
        }) as unknown,
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: {
          failedLoginAttempts: 3,
          lockedUntil: expect.any(Date) as Date,
        },
      });
    });

    it('rejects with 429 and never checks the password while still locked', async () => {
      const user = makeUser({
        failedLoginAttempts: 3,
        lockedUntil: new Date(Date.now() + 60_000),
      });
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        password: await bcrypt.hash('correct-password', 4),
      });

      await expect(
        service.login({ identifier: EMAIL, password: 'correct-password' }),
      ).rejects.toMatchObject({ status: 429 });

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('allows login again and resets the counter once lockedUntil has passed', async () => {
      const user = makeUser({
        failedLoginAttempts: 3,
        lockedUntil: new Date(Date.now() - 1000),
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

      expect(result).toHaveProperty('accessToken');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });

    it('clears a stale lock/counter before counting a wrong password after the lock expired, instead of re-locking on the 1st new attempt', async () => {
      const user = makeUser({
        failedLoginAttempts: 3,
        lockedUntil: new Date(Date.now() - 1000),
      });
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        password: await bcrypt.hash('correct-password', 4),
      });

      // Wrong password right after the old lock expired — this must be
      // treated as attempt 1 of a fresh cycle (clean slate), not attempt 4
      // of the old one, or it would instantly re-lock on a single guess.
      await expect(
        service.login({ identifier: EMAIL, password: 'wrong-password' }),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({
          attemptsRemaining: 2,
        }) as unknown,
      });

      // Cleared to 0 first (stale-lock cleanup), then bumped to 1 for this
      // guess — never left at 3 or jumped straight to locking again.
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { failedLoginAttempts: 1 },
      });
    });

    it('includes attemptsRemaining in the 401 body on a wrong password', async () => {
      const user = makeUser({ failedLoginAttempts: 1 });
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        password: await bcrypt.hash('correct-password', 4),
      });

      await expect(
        service.login({ identifier: EMAIL, password: 'wrong-password' }),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({
          statusCode: 401,
          message: 'Invalid credentials',
          attemptsRemaining: 1,
        }) as unknown,
      });
    });

    it('includes the same attemptsRemaining shape for an unregistered identifier as a first wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          identifier: 'nobody@example.com',
          password: 'anything',
        }),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({
          statusCode: 401,
          message: 'Invalid credentials',
          attemptsRemaining: 2,
        }) as unknown,
      });
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

    it('rejects with 429 while emailOtpLockedUntil is in the future, without generating a new code', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailOtpLockedUntil: new Date(Date.now() + 60_000) }),
      );

      await expect(service.sendEmailOtp(USER_ID)).rejects.toMatchObject({
        status: 429,
      });
      expect(resendService.sendOtpEmail).not.toHaveBeenCalled();
      expect(prisma.emailOtp.create).not.toHaveBeenCalled();
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

    it('rejects a wrong code, increments attempts, and reports attemptsRemaining', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.emailOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('654321'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      });
      prisma.emailOtp.update.mockResolvedValue({ attempts: 1 });

      await expect(
        service.verifyEmailOtp(EMAIL, '000000'),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          message: 'Invalid or expired code',
          attemptsRemaining: 2,
        }) as unknown,
      });
      expect(prisma.emailOtp.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attempts: { increment: 1 } },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an expired code, reporting a full attemptsRemaining since no attempt was consumed', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.emailOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('123456'),
        expiresAt: new Date(Date.now() - 1000),
        attempts: 0,
      });

      await expect(
        service.verifyEmailOtp(EMAIL, '123456'),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          message: 'Invalid or expired code',
          attemptsRemaining: 3,
        }) as unknown,
      });
    });

    it('rejects once the attempt cap is exceeded, with the same generic message and attemptsRemaining: 0', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.emailOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('123456'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 3,
      });

      await expect(
        service.verifyEmailOtp(EMAIL, '123456'),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          message: 'Invalid or expired code',
          attemptsRemaining: 0,
        }) as unknown,
      });
      expect(prisma.emailOtp.update).not.toHaveBeenCalled();
    });

    it('rejects an unregistered email with the same generic message and attemptsRemaining as a wrong code', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyEmailOtp('nobody@example.com', '123456'),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          message: 'Invalid or expired code',
          attemptsRemaining: 3,
        }) as unknown,
      });
    });

    it('locks the account for 5 minutes on the 3rd consecutive wrong code, returning 429 with retryAfterSeconds', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.emailOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('654321'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 2,
      });
      prisma.emailOtp.update.mockResolvedValue({ attempts: 3 });

      await expect(
        service.verifyEmailOtp(EMAIL, '000000'),
      ).rejects.toMatchObject({
        status: 429,
        response: expect.objectContaining({
          statusCode: 429,
          retryAfterSeconds: expect.any(Number) as number,
        }) as unknown,
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { emailOtpLockedUntil: expect.any(Date) as Date },
      });
    });

    it('rejects with 429 while emailOtpLockedUntil is still in the future, without touching the OTP row', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailOtpLockedUntil: new Date(Date.now() + 60_000) }),
      );

      await expect(
        service.verifyEmailOtp(EMAIL, '123456'),
      ).rejects.toMatchObject({ status: 429 });

      expect(prisma.emailOtp.findFirst).not.toHaveBeenCalled();
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

    it('rejects with 429 while phoneOtpLockedUntil is in the future, without generating a new code', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ phoneOtpLockedUntil: new Date(Date.now() + 60_000) }),
      );

      await expect(service.sendPhoneOtp(USER_ID)).rejects.toMatchObject({
        status: 429,
      });
      expect(smsProvider.sendOtpSms).not.toHaveBeenCalled();
      expect(prisma.phoneOtp.create).not.toHaveBeenCalled();
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

    it('rejects a wrong code, increments attempts, and reports attemptsRemaining', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.phoneOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('654321'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      });
      prisma.phoneOtp.update.mockResolvedValue({ attempts: 1 });

      await expect(
        service.verifyPhoneOtp(PHONE, '000000'),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          message: 'Invalid or expired code',
          attemptsRemaining: 2,
        }) as unknown,
      });
      expect(prisma.phoneOtp.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { attempts: { increment: 1 } },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an expired code, reporting a full attemptsRemaining since no attempt was consumed', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.phoneOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('123456'),
        expiresAt: new Date(Date.now() - 1000),
        attempts: 0,
      });

      await expect(
        service.verifyPhoneOtp(PHONE, '123456'),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          message: 'Invalid or expired code',
          attemptsRemaining: 3,
        }) as unknown,
      });
    });

    it('rejects once the attempt cap is exceeded, with the same generic message and attemptsRemaining: 0', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.phoneOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('123456'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 3,
      });

      await expect(
        service.verifyPhoneOtp(PHONE, '123456'),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          message: 'Invalid or expired code',
          attemptsRemaining: 0,
        }) as unknown,
      });
      expect(prisma.phoneOtp.update).not.toHaveBeenCalled();
    });

    it('rejects an unregistered phone with the same generic message and attemptsRemaining as a wrong code', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyPhoneOtp('0899999999', '123456'),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          message: 'Invalid or expired code',
          attemptsRemaining: 3,
        }) as unknown,
      });
    });

    it('locks the account for 5 minutes on the 3rd consecutive wrong code, returning 429 with retryAfterSeconds', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.phoneOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: service['hashToken']('654321'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 2,
      });
      prisma.phoneOtp.update.mockResolvedValue({ attempts: 3 });

      await expect(
        service.verifyPhoneOtp(PHONE, '000000'),
      ).rejects.toMatchObject({
        status: 429,
        response: expect.objectContaining({
          statusCode: 429,
          retryAfterSeconds: expect.any(Number) as number,
        }) as unknown,
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { phoneOtpLockedUntil: expect.any(Date) as Date },
      });
    });

    it('rejects with 429 while phoneOtpLockedUntil is still in the future, without touching the OTP row', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ phoneOtpLockedUntil: new Date(Date.now() + 60_000) }),
      );

      await expect(
        service.verifyPhoneOtp(PHONE, '123456'),
      ).rejects.toMatchObject({ status: 429 });

      expect(prisma.phoneOtp.findFirst).not.toHaveBeenCalled();
    });
  });
});
