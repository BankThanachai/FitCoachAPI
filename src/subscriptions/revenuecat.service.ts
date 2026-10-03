import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { revenueCatConfig } from './revenuecat.config';
import { RevenueCatSubscriber } from './subscription-state.util';

const API_BASE_URL = 'https://api.revenuecat.com/v1';
// RevenueCat gives up on a webhook delivery after 60s, so never let a slow
// lookup here eat the whole window.
const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class RevenueCatService {
  /**
   * Fetches the subscriber record for one of our users (RevenueCat's
   * `app_user_id` is our User.id — the app calls Purchases.logIn(userId)).
   * Resolves to null if RevenueCat has never heard of this user.
   */
  async getSubscriber(appUserId: string): Promise<RevenueCatSubscriber | null> {
    const secretKey = revenueCatConfig.secretApiKey;
    if (!secretKey) {
      throw new ServiceUnavailableException(
        'RevenueCat is not configured on this server',
      );
    }

    const response = await fetch(
      `${API_BASE_URL}/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `RevenueCat responded with status ${response.status}`,
      );
    }

    const body = (await response.json()) as {
      subscriber?: RevenueCatSubscriber;
    };
    return body.subscriber ?? null;
  }
}
