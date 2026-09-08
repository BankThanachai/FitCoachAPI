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
import { CreatePersonalLogExerciseSetDto } from './dto/create-personal-log-exercise-set.dto';
import { UpdatePersonalLogExerciseSetDto } from './dto/update-personal-log-exercise-set.dto';
import { PersonalLogExerciseSetsService } from './personal-log-exercise-sets.service';

@Controller({
  path: 'personal-logs/:personalLogId/exercises/:exerciseId/sets',
  version: '1',
})
@UseGuards(JwtAuthGuard)
export class PersonalLogExerciseSetsController {
  constructor(
    private readonly personalLogExerciseSetsService: PersonalLogExerciseSetsService,
  ) {}

  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Param('exerciseId') exerciseId: string,
    @Body() createPersonalLogExerciseSetDto: CreatePersonalLogExerciseSetDto,
  ) {
    return this.personalLogExerciseSetsService.create(
      exerciseId,
      request.user.sub,
      createPersonalLogExerciseSetDto,
    );
  }

  @Patch(':id')
  update(
    @Req() request: Request & { user: JwtPayload },
    @Param('exerciseId') exerciseId: string,
    @Param('id') id: string,
    @Body() updatePersonalLogExerciseSetDto: UpdatePersonalLogExerciseSetDto,
  ) {
    return this.personalLogExerciseSetsService.update(
      exerciseId,
      id,
      request.user.sub,
      updatePersonalLogExerciseSetDto,
    );
  }

  @Delete(':id')
  remove(
    @Req() request: Request & { user: JwtPayload },
    @Param('exerciseId') exerciseId: string,
    @Param('id') id: string,
  ) {
    return this.personalLogExerciseSetsService.remove(
      exerciseId,
      id,
      request.user.sub,
    );
  }
}
