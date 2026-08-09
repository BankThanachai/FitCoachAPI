import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DayOfWeek, Prisma, WorkingHour } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkingHourDto } from './dto/create-working-hour.dto';
import { UpdateWorkingHourDto } from './dto/update-working-hour.dto';

const DEFAULT_START_TIME = '08:00';
const DEFAULT_END_TIME = '17:00';

const ALL_DAYS: DayOfWeek[] = [
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
  DayOfWeek.Saturday,
  DayOfWeek.Sunday,
];

function timeStringToDate(time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours, minutes));
}

function dateToTimeString(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function serialize(workingHour: WorkingHour) {
  return {
    ...workingHour,
    startTime: dateToTimeString(workingHour.startTime),
    endTime: dateToTimeString(workingHour.endTime),
  };
}

@Injectable()
export class WorkingHoursService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, createWorkingHourDto: CreateWorkingHourDto) {
    const startTime = timeStringToDate(
      createWorkingHourDto.startTime ?? DEFAULT_START_TIME,
    );
    const endTime = timeStringToDate(
      createWorkingHourDto.endTime ?? DEFAULT_END_TIME,
    );

    try {
      const workingHours = await this.prisma.$transaction(
        ALL_DAYS.map((dayOfWeek) =>
          this.prisma.workingHour.create({
            data: { userId, dayOfWeek, startTime, endTime },
          }),
        ),
      );
      return workingHours.map(serialize);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Working hours have already been set up for this user',
        );
      }
      throw error;
    }
  }

  async findByUser(userId: string) {
    const workingHours = await this.prisma.workingHour.findMany({
      where: { userId },
      orderBy: { dayOfWeek: 'asc' },
    });
    return workingHours.map(serialize);
  }

  async update(
    userId: string,
    id: string,
    updateWorkingHourDto: UpdateWorkingHourDto,
  ) {
    const existing = await this.prisma.workingHour.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException(`Working hour with id ${id} not found`);
    }

    const workingHour = await this.prisma.workingHour.update({
      where: { id },
      data: {
        dayOfWeek: updateWorkingHourDto.dayOfWeek,
        startTime: updateWorkingHourDto.startTime
          ? timeStringToDate(updateWorkingHourDto.startTime)
          : undefined,
        endTime: updateWorkingHourDto.endTime
          ? timeStringToDate(updateWorkingHourDto.endTime)
          : undefined,
        status: updateWorkingHourDto.status,
      },
    });
    return serialize(workingHour);
  }
}
