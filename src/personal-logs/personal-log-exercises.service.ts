import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePersonalLogExerciseDto } from './dto/create-personal-log-exercise.dto';
import { UpdatePersonalLogExerciseDto } from './dto/update-personal-log-exercise.dto';

const SETS_ORDER_BY = { sets: { orderBy: { order: 'asc' as const } } };

@Injectable()
export class PersonalLogExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Confirms `personalLogId` exists and belongs to `clientId`. */
  private async ensureLogOwnership(personalLogId: string, clientId: string) {
    const log = await this.prisma.personalLog.findUnique({
      where: { id: personalLogId },
    });
    if (!log) {
      throw new NotFoundException(
        `Personal log with id ${personalLogId} not found`,
      );
    }
    if (log.clientId !== clientId) {
      throw new ForbiddenException('This personal log does not belong to you');
    }
  }

  /**
   * Confirms `id` is an exercise under `personalLogId`, and that the log
   * belongs to `clientId`. Used by update/remove so a client can't touch an
   * exercise on someone else's log by id alone.
   */
  private async ensureOwnedExercise(
    personalLogId: string,
    id: string,
    clientId: string,
  ) {
    await this.ensureLogOwnership(personalLogId, clientId);
    const exercise = await this.prisma.personalLogExercise.findFirst({
      where: { id, personalLogId },
    });
    if (!exercise) {
      throw new NotFoundException(
        `Personal log exercise with id ${id} not found`,
      );
    }
  }

  async create(
    personalLogId: string,
    clientId: string,
    createPersonalLogExerciseDto: CreatePersonalLogExerciseDto,
  ) {
    await this.ensureLogOwnership(personalLogId, clientId);
    return this.prisma.personalLogExercise.create({
      data: {
        name: createPersonalLogExerciseDto.name,
        personalLogId,
        sets: {
          create: createPersonalLogExerciseDto.sets.map((set) => ({
            order: set.order,
            weightKg: set.weightKg,
            reps: set.reps,
          })),
        },
      },
      include: SETS_ORDER_BY,
    });
  }

  async update(
    personalLogId: string,
    id: string,
    clientId: string,
    updatePersonalLogExerciseDto: UpdatePersonalLogExerciseDto,
  ) {
    await this.ensureOwnedExercise(personalLogId, id, clientId);
    return this.prisma.personalLogExercise.update({
      where: { id },
      data: updatePersonalLogExerciseDto,
      include: SETS_ORDER_BY,
    });
  }

  async remove(personalLogId: string, id: string, clientId: string) {
    await this.ensureOwnedExercise(personalLogId, id, clientId);
    return this.prisma.personalLogExercise.delete({ where: { id } });
  }
}
