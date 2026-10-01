import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

// Same 429 shape AuthService's per-account login lockout already uses
// (`{ statusCode, message, retryAfterSeconds }`) — so the mobile client
// reads `retryAfterSeconds` the same way regardless of which of the two
// independent rate limits (per-IP here, per-account in AuthService) it
// tripped. The stock ThrottlerGuard instead throws a bare
// "ThrottlerException: Too Many Requests" with no machine-readable
// remaining-time field, just a `Retry-After-<name>` header.
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  // Base class signature requires a Promise<void> return; this override
  // never needs to await anything before throwing.
  // eslint-disable-next-line @typescript-eslint/require-await
  protected async throwThrottlingException(
    _context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    // Once blockDuration kicks in, the storage layer reports the *block's*
    // remaining time via timeToBlockExpire, not the original request-window
    // ttl via timeToExpire (which would understate how long this IP is
    // actually blocked for — here, minutes vs. the real 30). Fall back to
    // timeToExpire only for a throttler with no blockDuration configured,
    // where timeToBlockExpire is always 0.
    const remainingSeconds = throttlerLimitDetail.isBlocked
      ? throttlerLimitDetail.timeToBlockExpire
      : throttlerLimitDetail.timeToExpire;
    const retryAfterSeconds = Math.max(1, Math.ceil(remainingSeconds));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests. Try again later.',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
