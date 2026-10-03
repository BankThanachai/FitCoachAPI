import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubscriptionsService } from './subscriptions.service';

@Injectable()
export class SubscriptionExpiryTask {
  private readonly logger = new Logger(SubscriptionExpiryTask.name);

  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Cron('0 0 * * *', {
    name: 'expire-lapsed-pro-subscriptions',
    timeZone: 'Asia/Bangkok',
  })
  async expireLapsedSubscriptions() {
    try {
      const count = await this.subscriptionsService.expireLapsedSubscriptions();
      if (count > 0) {
        this.logger.log(`Switched off Pro for ${count} lapsed subscription(s)`);
      }
    } catch (error) {
      // Must not escape: an unhandled rejection from a cron callback would
      // take the whole process down. The next run retries.
      this.logger.error(
        'Failed to expire lapsed subscriptions',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
