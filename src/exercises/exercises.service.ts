import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { UpdateExerciseDto } from './dto/update-exercise.dto';

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createdById: string, createExerciseDto: CreateExerciseDto) {
    const assignedTo = await this.prisma.user.findUnique({
      where: { id: createExerciseDto.assignedToId },
    });
    if (!assignedTo) {
      throw new NotFoundException('Assigned user not found');
    }

    const workout = await this.prisma.workout.findUnique({
      where: { id: createExerciseDto.workoutId },
    });
    if (!workout) {
      throw new NotFoundException('Workout not found');
    }

    return this.prisma.exercise.create({
      data: {
        name: createExerciseDto.name,
        muscleGroup: createExerciseDto.muscleGroup,
        note: createExerciseDto.note,
        assignedToId: createExerciseDto.assignedToId,
        createdById,
        workoutId: createExerciseDto.workoutId,
        sets: {
          create: createExerciseDto.sets.map((set) => ({
            order: set.order,
            weightKg: set.weightKg,
            reps: set.reps,
          })),
        },
      },
      include: { sets: true },
    });
  }

  async findAll() {
    return this.prisma.exercise.findMany({
      include: { sets: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id },
      include: { sets: true },
    });
    if (!exercise) {
      throw new NotFoundException(`Exercise with id ${id} not found`);
    }
    return exercise;
  }

  async findByAssigned(assignedToId: string) {
    const assignedTo = await this.prisma.user.findUnique({
      where: { id: assignedToId },
    });
    if (!assignedTo) {
      throw new NotFoundException(`User with id ${assignedToId} not found`);
    }

    return this.prisma.exercise.findMany({
      where: { assignedToId },
      include: { sets: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, updateExerciseDto: UpdateExerciseDto) {
    await this.findOne(id);

    if (updateExerciseDto.assignedToId) {
      const assignedTo = await this.prisma.user.findUnique({
        where: { id: updateExerciseDto.assignedToId },
      });
      if (!assignedTo) {
        throw new NotFoundException('Assigned user not found');
      }
    }

    return this.prisma.exercise.update({
      where: { id },
      data: updateExerciseDto,
      include: { sets: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.exercise.delete({ where: { id } });
  }
}
