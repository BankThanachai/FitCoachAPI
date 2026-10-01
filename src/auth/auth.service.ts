import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { authConfig } from './auth.config';
import { LoginDto } from './dto/login.dto';
import { ResendService } from './resend.service';
import { SMS_PROVIDER } from './sms/sms-provider.interface';
import type { SmsProvider } from './sms/sms-provider.interface';
import { JwtPayload } from './types/jwt-payload.type';

const REFRESH_TOKEN_BYTES = 64;
const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_LOCKOUT_MS = 5 * 60 * 1000;
const OTP_LOCKOUT_MESSAGE =
  'Too many failed verification attempts. Try again later.';
const LOGIN_MAX_ATTEMPTS = 3;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly resendService: ResendService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: this.resolveIdentifier(loginDto.identifier),
    });
    if (!user) {
      // Same body shape (including attemptsRemaining) as a wrong password
      // on a real account's first attempt, below — a response that were
      // missing the field here would let an attacker tell "no such
      // account" apart from "account exists, wrong password" purely from
      // whether attemptsRemaining is present, defeating the generic
      // "Invalid credentials" message's purpose.
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'Invalid credentials',
        attemptsRemaining: LOGIN_MAX_ATTEMPTS - 1,
      });
    }

    // Checked before touching the password at all: if this account is
    // already locked out, don't let a request "use up" a password check —
    // that would let an attacker distinguish "locked, and this guess would
    // have been right" from "locked, wrong guess" by timing/side channels,
    // and there's no reason to bcrypt.compare at all once we already know
    // the request can't succeed.
    let failedLoginAttempts = user.failedLoginAttempts;
    if (user.lockedUntil) {
      if (user.lockedUntil > new Date()) {
        this.throwLockedException(user.lockedUntil);
      }
      // The lock has expired, but failedLoginAttempts was left at the
      // threshold (3) when it was set — without clearing it here, the
      // very next wrong guess would re-lock the account immediately
      // (currentAttempts 3 + 1 >= LOGIN_MAX_ATTEMPTS), not after another
      // 3 in a row. A new lockout cycle needs to start from a clean slate,
      // same as a successful login already resets it to further down.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
      failedLoginAttempts = 0;
    }

    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      user.password,
    );
    if (!passwordMatches) {
      await this.registerFailedLogin(user.id, failedLoginAttempts);
    }

    if (failedLoginAttempts > 0) {
      // Any correct login clears a prior streak of failed attempts —
      // otherwise a legitimate user who mistyped their password a couple
      // of times would stay one mistake away from a lockout indefinitely.
      // (Already 0 here if the stale-lock cleanup above just ran.)
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    if (loginDto.fcmToken) {
      await this.saveDeviceToken(user.id, loginDto.fcmToken);
    }

    // Login itself is never blocked by an unverified email/phone — a correct
    // password is enough to get tokens. The client is expected to read
    // emailVerified/phoneVerified off this response and force the user
    // through whichever verify screen(s) are still pending before letting
    // them past that point in the app; the API doesn't gate anything past
    // login on this, on purpose, so a partially-verified account is never
    // locked out of getting a session.
    const tokens = await this.issueTokens(user.id, user.phone, user.type);
    return {
      ...tokens,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
    };
  }

  // Records a wrong password against this account. On the 3rd consecutive
  // failure it locks the account for LOGIN_LOCKOUT_MS and throws the same
  // 429 a currently-locked account gets — so the caller that just hit the
  // threshold finds out immediately, in the same response, rather than
  // being told "invalid credentials" and only discovering the lockout on
  // their next attempt.
  private async registerFailedLogin(userId: string, currentAttempts: number) {
    const attempts = currentAttempts + 1;

    if (attempts >= LOGIN_MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_MS);
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: attempts, lockedUntil },
      });
      this.throwLockedException(lockedUntil);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: attempts },
    });
    // attemptsRemaining lets the client show "N tries left" without
    // tracking the count itself — it would otherwise have no way to know
    // the server's count (e.g. after a reinstall, or a previous wrong
    // guess from a different device) and could drift from what the
    // backend actually enforces.
    throw new UnauthorizedException({
      statusCode: HttpStatus.UNAUTHORIZED,
      message: 'Invalid credentials',
      attemptsRemaining: LOGIN_MAX_ATTEMPTS - attempts,
    });
  }

  private throwLockedException(
    lockedUntil: Date,
    message = 'Too many failed login attempts. Try again later.',
  ): never {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((lockedUntil.getTime() - Date.now()) / 1000),
    );
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // A Thai phone number is stored as 0XXXXXXXXX (10 digits); anything
  // containing "@" is treated as an email. No other identifier shape is
  // accepted — class-validator only guarantees `identifier` is a non-empty
  // string, so an unrecognized shape is treated as a phone lookup and will
  // simply fail to match any user (same "Invalid credentials" response as
  // any other wrong login, no separate error path needed).
  private resolveIdentifier(identifier: string) {
    return identifier.includes('@')
      ? { email: identifier }
      : { phone: identifier };
  }

  // Generates and emails a fresh 6-digit OTP, invalidating any previous
  // unconsumed one for this user so only the latest code is ever valid.
  async sendEmailOtp(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    // A locked-out account can't get a fresh code either — otherwise
    // resend would be a way around the lock (burn through 5 attempts,
    // immediately resend to reset the attempt counter on a fresh row, and
    // the lock itself would never actually stop anyone). This also runs
    // on UsersService.create()'s auto-send path, but a brand-new user can
    // never already have emailOtpLockedUntil set, so it's a no-op there.
    if (user.emailOtpLockedUntil && user.emailOtpLockedUntil > new Date()) {
      this.throwLockedException(user.emailOtpLockedUntil, OTP_LOCKOUT_MESSAGE);
    }

    const latest = await this.prisma.emailOtp.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      throw new BadRequestException(
        'Please wait before requesting another code',
      );
    }

    const code = randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');

    await this.prisma.$transaction(async (tx) => {
      await tx.emailOtp.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.emailOtp.create({
        data: {
          userId,
          codeHash: this.hashToken(code),
          expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
        },
      });
    });

    await this.resendService.sendOtpEmail(user.email, code);
  }

  async resendEmailOtp(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Don't reveal whether an email is registered — behave the same as a
      // successful resend either way.
      return;
    }
    if (user.emailVerifiedAt) {
      return;
    }

    await this.sendEmailOtp(user.id);
  }

  // Generates and texts a fresh 6-digit OTP, invalidating any previous
  // unconsumed one for this user so only the latest code is ever valid.
  // Mirrors sendEmailOtp above — kept separate since callers, the target
  // field (phone vs email), and the delivery channel all differ.
  async sendPhoneOtp(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    // A locked-out account can't get a fresh code either — otherwise
    // resend would be a way around the lock (burn through 5 attempts,
    // immediately resend to reset the attempt counter on a fresh row, and
    // the lock itself would never actually stop anyone).
    if (user.phoneOtpLockedUntil && user.phoneOtpLockedUntil > new Date()) {
      this.throwLockedException(user.phoneOtpLockedUntil, OTP_LOCKOUT_MESSAGE);
    }

    const latest = await this.prisma.phoneOtp.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      throw new BadRequestException(
        'Please wait before requesting another code',
      );
    }

    const code = randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');

    await this.prisma.$transaction(async (tx) => {
      await tx.phoneOtp.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.phoneOtp.create({
        data: {
          userId,
          codeHash: this.hashToken(code),
          expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
        },
      });
    });

    await this.smsProvider.sendOtpSms(user.phone, code);
  }

  async resendPhoneOtp(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      // Don't reveal whether a phone number is registered — behave the same
      // as a successful resend either way.
      return;
    }
    if (user.phoneVerifiedAt) {
      return;
    }

    await this.sendPhoneOtp(user.id);
  }

  async verifyPhoneOtp(phone: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      // Same body shape (including attemptsRemaining) as a wrong code on a
      // real, freshly-sent OTP below — see the comment there.
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid or expired code',
        attemptsRemaining: OTP_MAX_ATTEMPTS,
      });
    }
    if (user.phoneVerifiedAt) {
      return { verified: true };
    }
    if (user.phoneOtpLockedUntil && user.phoneOtpLockedUntil > new Date()) {
      this.throwLockedException(user.phoneOtpLockedUntil, OTP_LOCKOUT_MESSAGE);
    }

    const otp = await this.prisma.phoneOtp.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // Same generic message and body shape for every failure path (no OTP
    // row, expired, or wrong code) — a distinguishable response for any
    // one of these would let an attacker fingerprint which phone numbers
    // are registered or how close a guess landed. No pending/expired code
    // reports a full attemptsRemaining (OTP_MAX_ATTEMPTS) since no attempt
    // has actually been consumed against it.
    if (!otp || otp.expiresAt < new Date()) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid or expired code',
        attemptsRemaining: OTP_MAX_ATTEMPTS,
      });
    }
    // Belt-and-suspenders alongside the phoneOtpLockedUntil check above:
    // that check only catches an active lock. If the 5-minute lock has
    // since expired but this same OTP row (created before the lock) is
    // still around with attempts already at the cap, it must not accept
    // guesses again just because the lock's clock ran out — the code
    // itself stays dead until a fresh one is requested via resend.
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid or expired code',
        attemptsRemaining: 0,
      });
    }

    if (this.hashToken(code) !== otp.codeHash) {
      await this.registerFailedOtpAttempt(
        this.prisma.phoneOtp,
        otp.id,
        user.id,
        'phoneOtpLockedUntil',
      );
    }

    await this.prisma.$transaction([
      this.prisma.phoneOtp.update({
        where: { id: otp.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date() },
      }),
    ]);

    return { verified: true };
  }

  async verifyEmailOtp(email: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Same body shape (including attemptsRemaining) as a wrong code on a
      // real, freshly-sent OTP below — see the comment there.
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid or expired code',
        attemptsRemaining: OTP_MAX_ATTEMPTS,
      });
    }
    if (user.emailVerifiedAt) {
      return { verified: true };
    }
    if (user.emailOtpLockedUntil && user.emailOtpLockedUntil > new Date()) {
      this.throwLockedException(user.emailOtpLockedUntil, OTP_LOCKOUT_MESSAGE);
    }

    const otp = await this.prisma.emailOtp.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // Same generic message and body shape for every failure path (no OTP
    // row, expired, or wrong code) — a distinguishable response for any
    // one of these would let an attacker fingerprint which emails are
    // registered or how close a guess landed. No pending/expired code
    // reports a full attemptsRemaining (OTP_MAX_ATTEMPTS) since no attempt
    // has actually been consumed against it.
    if (!otp || otp.expiresAt < new Date()) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid or expired code',
        attemptsRemaining: OTP_MAX_ATTEMPTS,
      });
    }
    // Belt-and-suspenders alongside the emailOtpLockedUntil check above:
    // that check only catches an active lock. If the 5-minute lock has
    // since expired but this same OTP row (created before the lock) is
    // still around with attempts already at the cap, it must not accept
    // guesses again just because the lock's clock ran out — the code
    // itself stays dead until a fresh one is requested via resend.
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid or expired code',
        attemptsRemaining: 0,
      });
    }

    if (this.hashToken(code) !== otp.codeHash) {
      await this.registerFailedOtpAttempt(
        this.prisma.emailOtp,
        otp.id,
        user.id,
        'emailOtpLockedUntil',
      );
    }

    await this.prisma.$transaction([
      this.prisma.emailOtp.update({
        where: { id: otp.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);

    return { verified: true };
  }

  // Shared by verifyEmailOtp/verifyPhoneOtp: records a wrong OTP code
  // against the OTP row, and on the 5th consecutive wrong attempt locks
  // the account (the same channel-specific field on User the corresponding
  // sendXxxOtp checks) for OTP_LOCKOUT_MS — mirroring registerFailedLogin's
  // shape for the login lockout. Always throws (never a wrong code without
  // rejecting the request), so callers don't fall through afterward.
  private async registerFailedOtpAttempt(
    otpDelegate: {
      update: (args: unknown) => Promise<{ attempts: number }>;
    },
    otpId: string,
    userId: string,
    lockField: 'emailOtpLockedUntil' | 'phoneOtpLockedUntil',
  ): Promise<never> {
    // Atomic increment at the DB level (attempts = attempts + 1), rather
    // than reading currentAttempts and computing attempts + 1 here — two
    // concurrent wrong guesses would otherwise both read the same starting
    // value and one increment could clobber the other, undercounting
    // attempts and letting the lock threshold be missed.
    const { attempts } = await otpDelegate.update({
      where: { id: otpId },
      data: { attempts: { increment: 1 } },
    });

    if (attempts >= OTP_MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + OTP_LOCKOUT_MS);
      await this.prisma.user.update({
        where: { id: userId },
        data: { [lockField]: lockedUntil },
      });
      this.throwLockedException(lockedUntil, OTP_LOCKOUT_MESSAGE);
    }

    // attemptsRemaining mirrors what registerFailedLogin already returns
    // for a wrong password — lets the client show "N tries left" without
    // tracking the count itself.
    throw new BadRequestException({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Invalid or expired code',
      attemptsRemaining: OTP_MAX_ATTEMPTS - attempts,
    });
  }

  private async saveDeviceToken(userId: string, token: string) {
    await this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId },
      create: { userId, token },
    });
  }

  async refresh(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(
      stored.user.id,
      stored.user.phone,
      stored.user.type,
    );
  }

  async logout(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, phone: string, type: string) {
    const payload: JwtPayload = { sub: userId, phone, type };
    const accessToken = await this.jwtService.signAsync(
      { ...payload },
      {
        secret: authConfig.accessSecret,
        expiresIn: authConfig.accessExpiresIn,
      },
    );

    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = this.resolveRefreshExpiry();

    await this.prisma.refreshToken.create({
      data: { tokenHash, userId, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private resolveRefreshExpiry() {
    const raw = authConfig.refreshExpiresIn;
    const match = /^(\d+)([smhd])$/.exec(raw);
    const value = match ? parseInt(match[1], 10) : 30;
    const unit = match ? match[2] : 'd';
    const unitMs: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return new Date(Date.now() + value * unitMs[unit]);
  }
}
