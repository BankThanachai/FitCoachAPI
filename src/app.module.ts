import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RequestLoggerMiddleware } from './shared/request-logger.middleware';
import { UsersModule } from './users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ExercisesModule } from './exercises/exercises.module';
import { CardiosModule } from './cardios/cardios.module';
import { ClientTrainersModule } from './client-trainers/client-trainers.module';
import { WorkingHoursModule } from './working-hours/working-hours.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { TrainerCoursesModule } from './trainer-courses/trainer-courses.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MessagesModule } from './messages/messages.module';
import { CouponsModule } from './coupons/coupons.module';
import { CoursePurchasesModule } from './course-purchases/course-purchases.module';
import { PaymentsModule } from './payments/payments.module';
import { PersonalLogsModule } from './personal-logs/personal-logs.module';
import { UploadsModule } from './uploads/uploads.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [
    // Named 'auth' throttler, applied only to AuthController's routes (see
    // its @Throttle decorators) — not a global guard, so it never affects
    // any other endpoint in the app. 10 requests/minute per IP: loose
    // enough that a shared office/NAT IP with several people mistyping
    // passwords won't get blocked, but tight enough to flag a brute-force
    // script. Once that limit is exceeded, blockDuration keeps that IP
    // blocked for a full 30 minutes — not just until the 1-minute window
    // rolls over — so going over the limit is a real penalty, not just a
    // brief pause before trying again. This is deliberately separate from
    // (and looser than) AuthService's per-account lockout (3 wrong
    // passwords -> 5 min lock) — the IP limit's job is stopping
    // credential-stuffing across many accounts from one IP, not protecting
    // any single account, which the account-level lockout already does.
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'auth', ttl: 60_000, limit: 10, blockDuration: 30 * 60_000 },
      ],
    }),
    ScheduleModule.forRoot(),
    UsersModule,
    PrismaModule,
    AuthModule,
    ReviewsModule,
    ExercisesModule,
    CardiosModule,
    ClientTrainersModule,
    WorkingHoursModule,
    WorkoutsModule,
    TrainerCoursesModule,
    NotificationsModule,
    MessagesModule,
    CouponsModule,
    CoursePurchasesModule,
    PaymentsModule,
    PersonalLogsModule,
    UploadsModule,
    SubscriptionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
