import { ForbiddenException } from '@nestjs/common';

/**
 * 403 with a machine-readable `code` so the app can tell "you need Pro for
 * this" (open the paywall) apart from an ordinary permission error. The
 * backend had no `code` convention in error bodies before this.
 */
export class ProRequiredException extends ForbiddenException {
  constructor(message: string) {
    super({ statusCode: 403, code: 'PRO_REQUIRED', message });
  }
}
