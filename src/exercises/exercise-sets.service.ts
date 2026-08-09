import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExerciseSetDto } from './dto/create-exercise-set.dto';
import { UpdateExerciseSetDto } from './dto/update-exercise-set.dto';

@Injectable()
export class ExerciseSetsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureExerciseExists(exerciseId: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
    });
    if (!exercise) {
      throw new NotFoundException(`Exercise with id ${exerciseId} not found`);
    }
  }

  async create(exerciseId: string, createExerciseSetDto: CreateExerciseSetDto) {
    await this.ensureExerciseExists(exerciseId);

    return this.prisma.exerciseSet.create({
      data: { ...createExerciseSetDto, exerciseId },
    });
  }

  async findAll(exerciseId: string) {
    await this.ensureExerciseExists(exerciseId);

    return this.prisma.exerciseSet.findMany({
      where: { exerciseId },
      orderBy: { order: 'asc' },
    });
  }

  async findOne(exerciseId: string, id: string) {
    const set = await this.prisma.exerciseSet.findFirst({
      where: { id, exerciseId },
    });
    if (!set) {
      throw new NotFoundException(`Exercise set with id ${id} not found`);
    }
    return set;
  }

  async update(
    exerciseId: string,
    id: string,
    updateExerciseSetDto: UpdateExerciseSetDto,
  ) {
    await this.findOne(exerciseId, id);
    return this.prisma.exerciseSet.update({
      where: { id },
      data: updateExerciseSetDto,
    });
  }

  async remove(exerciseId: string, id: string) {
    await this.findOne(exerciseId, id);
    return this.prisma.exerciseSet.delete({ where: { id } });
  }
}
