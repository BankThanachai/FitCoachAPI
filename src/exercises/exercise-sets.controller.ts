import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateExerciseSetDto } from './dto/create-exercise-set.dto';
import { UpdateExerciseSetDto } from './dto/update-exercise-set.dto';
import { ExerciseSetsService } from './exercise-sets.service';

@Controller({ path: 'exercises/:exerciseId/sets', version: '1' })
@UseGuards(JwtAuthGuard)
export class ExerciseSetsController {
  constructor(private readonly exerciseSetsService: ExerciseSetsService) {}

  @Post()
  create(
    @Param('exerciseId') exerciseId: string,
    @Body() createExerciseSetDto: CreateExerciseSetDto,
  ) {
    return this.exerciseSetsService.create(exerciseId, createExerciseSetDto);
  }

  @Get()
  findAll(@Param('exerciseId') exerciseId: string) {
    return this.exerciseSetsService.findAll(exerciseId);
  }

  @Get(':id')
  findOne(@Param('exerciseId') exerciseId: string, @Param('id') id: string) {
    return this.exerciseSetsService.findOne(exerciseId, id);
  }

  @Patch(':id')
  update(
    @Param('exerciseId') exerciseId: string,
    @Param('id') id: string,
    @Body() updateExerciseSetDto: UpdateExerciseSetDto,
  ) {
    return this.exerciseSetsService.update(
      exerciseId,
      id,
      updateExerciseSetDto,
    );
  }

  @Delete(':id')
  remove(@Param('exerciseId') exerciseId: string, @Param('id') id: string) {
    return this.exerciseSetsService.remove(exerciseId, id);
  }
}
