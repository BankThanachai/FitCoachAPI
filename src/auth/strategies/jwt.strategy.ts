import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { authConfig } from '../auth.config';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: authConfig.accessSecret,
    });
  }

  // A valid signature isn't enough: the account must still be Active. Without
  // this, an access token issued before a user was deactivated would keep
  // working until it expires, and a deactivated user could still call the API
  // (and have their own data returned) for up to JWT_ACCESS_EXPIRES_IN.
  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, status: UserStatus.Active },
      select: { id: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return payload;
  }
}
