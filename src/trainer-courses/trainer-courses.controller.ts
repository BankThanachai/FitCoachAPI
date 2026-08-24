import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateTrainerCourseDto } from './dto/create-trainer-course.dto';
import { UpdateTrainerCourseDto } from './dto/update-trainer-course.dto';
import { TrainerCoursesService } from './trainer-courses.service';

@Controller({ path: 'users/me/trainer-courses', version: '1' })
@UseGuards(JwtAuthGuard)
export class TrainerCoursesController {
  constructor(private readonly trainerCoursesService: TrainerCoursesService) {}

  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Body() createTrainerCourseDto: CreateTrainerCourseDto,
  ) {
    return this.trainerCoursesService.create(
      request.user.sub,
      createTrainerCourseDto,
    );
  }

  @Get()
  findMine(@Req() request: Request & { user: JwtPayload }) {
    return this.trainerCoursesService.findByTrainer(request.user.sub);
  }

  @Patch(':id')
  update(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
    @Body() updateTrainerCourseDto: UpdateTrainerCourseDto,
  ) {
    return this.trainerCoursesService.update(
      request.user.sub,
      id,
      updateTrainerCourseDto,
    );
  }

  @Delete(':id')
  remove(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.trainerCoursesService.remove(request.user.sub, id);
  }
}
