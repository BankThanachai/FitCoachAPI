import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersonalLogExerciseSetsController } from './personal-log-exercise-sets.controller';
import { PersonalLogExerciseSetsService } from './personal-log-exercise-sets.service';
import { PersonalLogExercisesController } from './personal-log-exercises.controller';
import { PersonalLogExercisesService } from './personal-log-exercises.service';
import { PersonalLogsController } from './personal-logs.controller';
import { PersonalLogsService } from './personal-logs.service';

@Module({
  imports: [AuthModule],
  controllers: [
    PersonalLogsController,
    PersonalLogExercisesController,
    PersonalLogExerciseSetsController,
  ],
  providers: [
    PersonalLogsService,
    PersonalLogExercisesService,
    PersonalLogExerciseSetsService,
  ],
})
export class PersonalLogsModule {}
