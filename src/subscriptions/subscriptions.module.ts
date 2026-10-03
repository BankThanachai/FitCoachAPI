import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RevenueCatService } from './revenuecat.service';
import { RevenueCatWebhookGuard } from './revenuecat-webhook.guard';
import { SubscriptionExpiryTask } from './subscription-expiry.task';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [AuthModule],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    RevenueCatService,
    RevenueCatWebhookGuard,
    SubscriptionExpiryTask,
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
