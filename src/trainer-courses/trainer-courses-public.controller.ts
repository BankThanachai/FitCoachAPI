import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TrainerCoursesService } from './trainer-courses.service';

@Controller({ path: 'trainers/:trainerId/courses', version: '1' })
@UseGuards(JwtAuthGuard)
export class TrainerCoursesPublicController {
  constructor(private readonly trainerCoursesService: TrainerCoursesService) {}

  @Get()
  findByTrainer(@Param('trainerId') trainerId: string) {
    return this.trainerCoursesService.findByTrainer(trainerId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.trainerCoursesService.findOne(id);
  }
}
