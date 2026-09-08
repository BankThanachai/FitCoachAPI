import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePersonalLogExerciseSetDto } from './dto/create-personal-log-exercise-set.dto';
import { UpdatePersonalLogExerciseSetDto } from './dto/update-personal-log-exercise-set.dto';

@Injectable()
export class PersonalLogExerciseSetsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Confirms `exerciseId` exists under a `PersonalLog` owned by `clientId`.
   * Every set operation is scoped through this so a client can't touch a
   * set on someone else's log by id alone.
   */
  private async ensureOwnedExercise(exerciseId: string, clientId: string) {
    const exercise = await this.prisma.personalLogExercise.findUnique({
      where: { id: exerciseId },
      include: { personalLog: true },
    });
    if (!exercise) {
      throw new NotFoundException(
        `Personal log exercise with id ${exerciseId} not found`,
      );
    }
    if (exercise.personalLog.clientId !== clientId) {
      throw new ForbiddenException('This personal log does not belong to you');
    }
  }

  private async ensureOwnedSet(
    exerciseId: string,
    id: string,
    clientId: string,
  ) {
    await this.ensureOwnedExercise(exerciseId, clientId);
    const set = await this.prisma.personalLogExerciseSet.findFirst({
      where: { id, personalLogExerciseId: exerciseId },
    });
    if (!set) {
      throw new NotFoundException(`Personal log set with id ${id} not found`);
    }
  }

  async create(
    exerciseId: string,
    clientId: string,
    createDto: CreatePersonalLogExerciseSetDto,
  ) {
    await this.ensureOwnedExercise(exerciseId, clientId);
    return this.prisma.personalLogExerciseSet.create({
      data: { ...createDto, personalLogExerciseId: exerciseId },
    });
  }

  async update(
    exerciseId: string,
    id: string,
    clientId: string,
    updateDto: UpdatePersonalLogExerciseSetDto,
  ) {
    await this.ensureOwnedSet(exerciseId, id, clientId);
    return this.prisma.personalLogExerciseSet.update({
      where: { id },
      data: updateDto,
    });
  }

  async remove(exerciseId: string, id: string, clientId: string) {
    await this.ensureOwnedSet(exerciseId, id, clientId);
    return this.prisma.personalLogExerciseSet.delete({ where: { id } });
  }
}
