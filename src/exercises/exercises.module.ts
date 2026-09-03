import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExerciseSetsController } from './exercise-sets.controller';
import { ExerciseSetsService } from './exercise-sets.service';
import { ExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ExercisesController, ExerciseSetsController],
  providers: [ExercisesService, ExerciseSetsService],
})
export class ExercisesModule {}
