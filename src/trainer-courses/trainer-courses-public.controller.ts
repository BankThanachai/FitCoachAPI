import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { TrainerCoursesService } from './trainer-courses.service';

@Controller({ path: 'trainers/:trainerId/courses', version: '1' })
@UseGuards(JwtAuthGuard)
export class TrainerCoursesPublicController {
  constructor(private readonly trainerCoursesService: TrainerCoursesService) {}

  @Get()
  findByTrainer(
    @Req() request: Request & { user: JwtPayload },
    @Param('trainerId') trainerId: string,
  ) {
    return this.trainerCoursesService.findByTrainerForViewer(
      trainerId,
      request.user,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.trainerCoursesService.findOne(id);
  }
}
