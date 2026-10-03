import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoursePurchasesModule } from '../course-purchases/course-purchases.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SharedModule } from '../shared/shared.module';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    CoursePurchasesModule,
    SharedModule,
  ],
  controllers: [WorkoutsController],
  providers: [WorkoutsService],
})
export class WorkoutsModule {}
