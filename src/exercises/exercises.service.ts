import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';

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

    return this.prisma.exercise.create({
      data: {
        name: createExerciseDto.name,
        muscleGroup: createExerciseDto.muscleGroup,
        note: createExerciseDto.note,
        assignedToId: createExerciseDto.assignedToId,
        createdById,
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
}
