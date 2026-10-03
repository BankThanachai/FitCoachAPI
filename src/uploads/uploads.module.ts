import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SharedModule } from '../shared/shared.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [AuthModule, SharedModule, SubscriptionsModule],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
