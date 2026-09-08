import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../shared/pagination.util';
import { CreatePersonalLogDto } from './dto/create-personal-log.dto';
import { UpdatePersonalLogDto } from './dto/update-personal-log.dto';

const PERSONAL_LOG_INCLUDE = {
  exercises: { include: { sets: { orderBy: { order: 'asc' as const } } } },
} as const;

@Injectable()
export class PersonalLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A client's private training log for a day — self-recorded, not tied to
   * any trainer, course, or purchase. Distinct from Workout, which always
   * represents a session between a client and a trainer.
   */
  async create(clientId: string, createPersonalLogDto: CreatePersonalLogDto) {
    return this.prisma.personalLog.create({
      data: {
        clientId,
        date: new Date(createPersonalLogDto.date),
        note: createPersonalLogDto.note,
        exercises: {
          create: createPersonalLogDto.exercises.map((exercise) => ({
            name: exercise.name,
            sets: {
              create: exercise.sets.map((set) => ({
                order: set.order,
                weightKg: set.weightKg,
                reps: set.reps,
              })),
            },
          })),
        },
      },
      include: PERSONAL_LOG_INCLUDE,
    });
  }

  async findByClient(clientId: string, page: number, pageSize: number) {
    const [logs, total] = await Promise.all([
      this.prisma.personalLog.findMany({
        where: { clientId },
        include: PERSONAL_LOG_INCLUDE,
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.personalLog.count({ where: { clientId } }),
    ]);
    return paginate(logs, page, pageSize, total);
  }

  async findOne(id: string, clientId: string) {
    const log = await this.prisma.personalLog.findUnique({
      where: { id },
      include: PERSONAL_LOG_INCLUDE,
    });
    if (!log) {
      throw new NotFoundException(`Personal log with id ${id} not found`);
    }
    if (log.clientId !== clientId) {
      throw new ForbiddenException('This personal log does not belong to you');
    }
    return log;
  }

  async update(
    id: string,
    clientId: string,
    updatePersonalLogDto: UpdatePersonalLogDto,
  ) {
    await this.findOne(id, clientId);
    return this.prisma.personalLog.update({
      where: { id },
      data: {
        date: updatePersonalLogDto.date
          ? new Date(updatePersonalLogDto.date)
          : undefined,
        note: updatePersonalLogDto.note,
      },
      include: PERSONAL_LOG_INCLUDE,
    });
  }

  async remove(id: string, clientId: string) {
    await this.findOne(id, clientId);
    return this.prisma.personalLog.delete({ where: { id } });
  }
}
