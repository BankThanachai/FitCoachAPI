import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreatePersonalLogExerciseDto } from './dto/create-personal-log-exercise.dto';
import { UpdatePersonalLogExerciseDto } from './dto/update-personal-log-exercise.dto';
import { PersonalLogExercisesService } from './personal-log-exercises.service';

@Controller({ path: 'personal-logs/:personalLogId/exercises', version: '1' })
@UseGuards(JwtAuthGuard)
export class PersonalLogExercisesController {
  constructor(
    private readonly personalLogExercisesService: PersonalLogExercisesService,
  ) {}

  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Param('personalLogId') personalLogId: string,
    @Body() createPersonalLogExerciseDto: CreatePersonalLogExerciseDto,
  ) {
    return this.personalLogExercisesService.create(
      personalLogId,
      request.user.sub,
      createPersonalLogExerciseDto,
    );
  }

  @Patch(':id')
  update(
    @Req() request: Request & { user: JwtPayload },
    @Param('personalLogId') personalLogId: string,
    @Param('id') id: string,
    @Body() updatePersonalLogExerciseDto: UpdatePersonalLogExerciseDto,
  ) {
    return this.personalLogExercisesService.update(
      personalLogId,
      id,
      request.user.sub,
      updatePersonalLogExerciseDto,
    );
  }

  @Delete(':id')
  remove(
    @Req() request: Request & { user: JwtPayload },
    @Param('personalLogId') personalLogId: string,
    @Param('id') id: string,
  ) {
    return this.personalLogExercisesService.remove(
      personalLogId,
      id,
      request.user.sub,
    );
  }
}
