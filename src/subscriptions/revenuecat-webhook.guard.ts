import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { revenueCatConfig } from './revenuecat.config';

// Hashing both sides first gives timingSafeEqual equal-length buffers, so the
// comparison is constant-time without leaking the secret's length.
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Authenticates RevenueCat's webhook deliveries by the Authorization header
 * value configured on the webhook in the RevenueCat dashboard. Fails closed:
 * with no REVENUECAT_WEBHOOK_AUTH configured, every delivery is rejected,
 * since there'd be nothing to tell RevenueCat apart from anyone else.
 */
@Injectable()
export class RevenueCatWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = revenueCatConfig.webhookAuth;
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers.authorization;

    if (
      !expected ||
      !provided ||
      !timingSafeEqual(digest(provided), digest(expected))
    ) {
      throw new UnauthorizedException('Invalid webhook credentials');
    }
    return true;
  }
}
