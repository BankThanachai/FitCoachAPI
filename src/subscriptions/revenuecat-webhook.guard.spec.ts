import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { RevenueCatWebhookGuard } from './revenuecat-webhook.guard';

function contextWith(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

describe('RevenueCatWebhookGuard', () => {
  const guard = new RevenueCatWebhookGuard();
  const originalAuth = process.env.REVENUECAT_WEBHOOK_AUTH;

  afterEach(() => {
    if (originalAuth === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_AUTH;
    } else {
      process.env.REVENUECAT_WEBHOOK_AUTH = originalAuth;
    }
  });

  it('allows a request whose Authorization header matches the configured secret', () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = 'Bearer s3cret';

    expect(guard.canActivate(contextWith('Bearer s3cret'))).toBe(true);
  });

  it('rejects a wrong header value', () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = 'Bearer s3cret';

    expect(() => guard.canActivate(contextWith('Bearer nope'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with no Authorization header', () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = 'Bearer s3cret';

    expect(() => guard.canActivate(contextWith(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('fails closed when no secret is configured', () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;

    expect(() => guard.canActivate(contextWith('anything'))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(contextWith(''))).toThrow(
      UnauthorizedException,
    );
  });
});
