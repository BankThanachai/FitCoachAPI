import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  WorkoutStatus,
} from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { UpdateExerciseDto } from './dto/update-exercise.dto';

@Injectable()
export class ExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

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
    if (workout.status === WorkoutStatus.Cancelled) {
      throw new BadRequestException(
        'Cannot add exercises to a cancelled workout',
      );
    }

    const exercise = await this.prisma.exercise.create({
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

    // Adding exercises to a workout implicitly confirms it, but only from
    // Pending — an already Confirmed or Completed workout keeps its status.
    // The status guard lives in the where clause so a concurrent update
    // can't be clobbered, and count tells us whether we actually confirmed.
    const { count } = await this.prisma.workout.updateMany({
      where: { id: workout.id, status: WorkoutStatus.Pending },
      data: { status: WorkoutStatus.Confirmed },
    });

    if (count > 0) {
      await this.notificationsService.create({
        userId: workout.clientId,
        type: NotificationType.WorkoutConfirmed,
        title: 'Workout confirmed',
        body: `Your workout on ${workout.date.toISOString().slice(0, 10)} has been confirmed`,
        entityType: 'Workout',
        entityId: workout.id,
      });
    }

    return exercise;
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
