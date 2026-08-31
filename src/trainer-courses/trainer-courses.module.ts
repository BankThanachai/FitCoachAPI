import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CouponsModule } from '../coupons/coupons.module';
import { TrainerCoursesPublicController } from './trainer-courses-public.controller';
import { TrainerCoursesController } from './trainer-courses.controller';
import { TrainerCoursesService } from './trainer-courses.service';

@Module({
  imports: [AuthModule, CouponsModule],
  controllers: [TrainerCoursesController, TrainerCoursesPublicController],
  providers: [TrainerCoursesService],
})
export class TrainerCoursesModule {}
