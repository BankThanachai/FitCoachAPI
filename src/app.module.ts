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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
