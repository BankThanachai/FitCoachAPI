import {
  BadRequestException,
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
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

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
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      user.password,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
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
      throw new BadRequestException('Invalid or expired code');
    }
    if (user.phoneVerifiedAt) {
      return { verified: true };
    }

    const otp = await this.prisma.phoneOtp.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // Same generic message for every failure path (no OTP row, expired,
    // attempt cap hit, or wrong code) — a distinguishable response for any
    // one of these would let an attacker fingerprint which phone numbers
    // are registered or how close a guess landed.
    if (
      !otp ||
      otp.expiresAt < new Date() ||
      otp.attempts >= OTP_MAX_ATTEMPTS
    ) {
      throw new BadRequestException('Invalid or expired code');
    }

    if (this.hashToken(code) !== otp.codeHash) {
      await this.prisma.phoneOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid or expired code');
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
      throw new BadRequestException('Invalid or expired code');
    }
    if (user.emailVerifiedAt) {
      return { verified: true };
    }

    const otp = await this.prisma.emailOtp.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // Same generic message for every failure path (no OTP row, expired,
    // attempt cap hit, or wrong code) — a distinguishable response for any
    // one of these would let an attacker fingerprint which emails are
    // registered or how close a guess landed.
    if (
      !otp ||
      otp.expiresAt < new Date() ||
      otp.attempts >= OTP_MAX_ATTEMPTS
    ) {
      throw new BadRequestException('Invalid or expired code');
    }

    if (this.hashToken(code) !== otp.codeHash) {
      await this.prisma.emailOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid or expired code');
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
