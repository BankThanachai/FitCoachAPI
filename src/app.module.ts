import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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

@Module({
  imports: [
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
