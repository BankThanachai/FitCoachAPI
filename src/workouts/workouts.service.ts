import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DayOfWeek,
  NotificationType,
  UserType,
  WorkingHourStatus,
  Workout,
  WorkoutStatus,
} from '../../generated/prisma/client';
import { CouponsService } from '../coupons/coupons.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { UpdateWorkoutDto } from './dto/update-workout.dto';

const SLOT_MINUTES = 60;

const DAYS_BY_JS_INDEX: DayOfWeek[] = [
  DayOfWeek.Sunday,
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
  DayOfWeek.Saturday,
];

function timeStringToDate(time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours, minutes));
}

function dateToTimeString(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function serialize(workout: Workout) {
  return {
    ...workout,
    date: workout.date.toISOString().slice(0, 10),
    fromTime: dateToTimeString(workout.fromTime),
    toTime: dateToTimeString(workout.toTime),
  };
}

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly couponsService: CouponsService,
  ) {}

  private async ensureNoOverlap(
    trainerId: string,
    date: Date,
    fromTime: Date,
    toTime: Date,
    excludeWorkoutId?: string,
  ) {
    const overlapping = await this.prisma.workout.findFirst({
      where: {
        id: excludeWorkoutId ? { not: excludeWorkoutId } : undefined,
        trainerId,
        date,
        fromTime: { lt: toTime },
        toTime: { gt: fromTime },
      },
    });
    if (overlapping) {
      throw new ConflictException(
        'This trainer already has a workout booked during that time',
      );
    }
  }

  async create(createWorkoutDto: CreateWorkoutDto) {
    const trainer = await this.prisma.user.findUnique({
      where: { id: createWorkoutDto.trainerId },
    });
    if (!trainer) {
      throw new NotFoundException('Trainer not found');
    }
    if (trainer.type !== UserType.Trainer) {
      throw new BadRequestException('Target user is not a trainer');
    }

    const client = await this.prisma.user.findUnique({
      where: { id: createWorkoutDto.clientId },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    if (client.type !== UserType.Client) {
      throw new BadRequestException('Target user is not a client');
    }

    const date = new Date(createWorkoutDto.date);
    const fromTime = timeStringToDate(createWorkoutDto.fromTime);
    const toTime = timeStringToDate(createWorkoutDto.toTime);
    if (fromTime >= toTime) {
      throw new BadRequestException('fromTime must be before toTime');
    }

    await this.ensureNoOverlap(
      createWorkoutDto.trainerId,
      date,
      fromTime,
      toTime,
    );

    if (createWorkoutDto.couponId) {
      const { eligible } = await this.couponsService.checkEligibility(
        createWorkoutDto.couponId,
        createWorkoutDto.clientId,
        createWorkoutDto.trainerId,
      );
      if (!eligible) {
        throw new BadRequestException(
          'You have not trained enough hours with this trainer to use this coupon',
        );
      }
    }

    const workout = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workout.create({
        data: {
          trainerId: createWorkoutDto.trainerId,
          clientId: createWorkoutDto.clientId,
          date,
          fromTime,
          toTime,
          couponId: createWorkoutDto.couponId,
        },
      });

      if (createWorkoutDto.couponId) {
        await this.couponsService.redeem(
          tx,
          createWorkoutDto.couponId,
          createWorkoutDto.trainerId,
        );
      }

      return created;
    });

    await this.notificationsService.create({
      userId: createWorkoutDto.trainerId,
      type: NotificationType.WorkoutBooked,
      title: 'New workout booked',
      body: `${client.name ?? 'A client'} booked a workout on ${createWorkoutDto.date}`,
      entityType: 'Workout',
      entityId: workout.id,
    });

    return serialize(workout);
  }

  async findAll() {
    const workouts = await this.prisma.workout.findMany({
      include: { exercises: { include: { sets: true } } },
      orderBy: [{ date: 'desc' }, { fromTime: 'asc' }],
    });
    return workouts.map(serialize);
  }

  async findByClient(clientId: string) {
    const workouts = await this.prisma.workout.findMany({
      where: { clientId },
      include: { exercises: { include: { sets: true } } },
      orderBy: [{ date: 'desc' }, { fromTime: 'asc' }],
    });
    return workouts.map(serialize);
  }

  async findByTrainer(trainerId: string) {
    const workouts = await this.prisma.workout.findMany({
      where: { trainerId },
      include: { exercises: { include: { sets: true } } },
      orderBy: [{ date: 'desc' }, { fromTime: 'asc' }],
    });
    return workouts.map(serialize);
  }

  async findOne(id: string) {
    const workout = await this.prisma.workout.findUnique({
      where: { id },
      include: { exercises: { include: { sets: true } } },
    });
    if (!workout) {
      throw new NotFoundException(`Workout with id ${id} not found`);
    }
    return serialize(workout);
  }

  async update(id: string, updateWorkoutDto: UpdateWorkoutDto) {
    const existing = await this.prisma.workout.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Workout with id ${id} not found`);
    }

    const date = updateWorkoutDto.date
      ? new Date(updateWorkoutDto.date)
      : existing.date;
    const fromTime = updateWorkoutDto.fromTime
      ? timeStringToDate(updateWorkoutDto.fromTime)
      : existing.fromTime;
    const toTime = updateWorkoutDto.toTime
      ? timeStringToDate(updateWorkoutDto.toTime)
      : existing.toTime;
    if (fromTime >= toTime) {
      throw new BadRequestException('fromTime must be before toTime');
    }

    if (
      updateWorkoutDto.date ||
      updateWorkoutDto.fromTime ||
      updateWorkoutDto.toTime
    ) {
      await this.ensureNoOverlap(
        existing.trainerId,
        date,
        fromTime,
        toTime,
        id,
      );
    }

    const workout = await this.prisma.workout.update({
      where: { id },
      data: { date, fromTime, toTime, status: updateWorkoutDto.status },
    });

    if (
      updateWorkoutDto.status &&
      updateWorkoutDto.status !== existing.status &&
      (updateWorkoutDto.status === WorkoutStatus.Confirmed ||
        updateWorkoutDto.status === WorkoutStatus.Cancelled)
    ) {
      const isConfirmed = updateWorkoutDto.status === WorkoutStatus.Confirmed;
      await this.notificationsService.create({
        userId: workout.clientId,
        type: isConfirmed
          ? NotificationType.WorkoutConfirmed
          : NotificationType.WorkoutCancelled,
        title: isConfirmed ? 'Workout confirmed' : 'Workout cancelled',
        body: isConfirmed
          ? `Your workout on ${serialize(workout).date} has been confirmed`
          : `Your workout on ${serialize(workout).date} has been cancelled`,
        entityType: 'Workout',
        entityId: workout.id,
      });
    }

    return serialize(workout);
  }

  private computeSlots(
    workingHour: { startTime: Date; endTime: Date },
    bookedWorkouts: { fromTime: Date; toTime: Date }[],
  ) {
    const slots: { from: string; to: string; isAvailable: boolean }[] = [];
    let slotStart = workingHour.startTime;
    while (true) {
      const slotEnd = addMinutes(slotStart, SLOT_MINUTES);
      if (slotEnd > workingHour.endTime) {
        break;
      }

      const isBooked = bookedWorkouts.some(
        (workout) => workout.fromTime < slotEnd && workout.toTime > slotStart,
      );
      slots.push({
        from: dateToTimeString(slotStart),
        to: dateToTimeString(slotEnd),
        isAvailable: !isBooked,
      });

      slotStart = slotEnd;
    }

    return slots;
  }

  private async ensureTrainer(trainerId: string) {
    const trainer = await this.prisma.user.findUnique({
      where: { id: trainerId },
    });
    if (!trainer) {
      throw new NotFoundException('Trainer not found');
    }
    if (trainer.type !== UserType.Trainer) {
      throw new BadRequestException('Target user is not a trainer');
    }
  }

  async getAvailableTimeOnDate(trainerId: string, dateStr: string) {
    await this.ensureTrainer(trainerId);

    const date = new Date(dateStr);
    const dayOfWeek = DAYS_BY_JS_INDEX[date.getUTCDay()];

    const workingHour = await this.prisma.workingHour.findUnique({
      where: { userId_dayOfWeek: { userId: trainerId, dayOfWeek } },
    });
    if (!workingHour || workingHour.status !== WorkingHourStatus.Active) {
      return [];
    }

    const bookedWorkouts = await this.prisma.workout.findMany({
      where: {
        trainerId,
        date,
        status: { not: WorkoutStatus.Cancelled },
      },
      orderBy: { fromTime: 'asc' },
    });

    return this.computeSlots(workingHour, bookedWorkouts);
  }

  async getAvailableOnMonth(trainerId: string, monthStr: string) {
    await this.ensureTrainer(trainerId);

    const [year, month] = monthStr.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month - 1, daysInMonth));

    const workingHours = await this.prisma.workingHour.findMany({
      where: { userId: trainerId },
    });
    const workingHourByDay = new Map(
      workingHours.map((workingHour) => [workingHour.dayOfWeek, workingHour]),
    );

    const bookedWorkouts = await this.prisma.workout.findMany({
      where: {
        trainerId,
        date: { gte: monthStart, lte: monthEnd },
        status: { not: WorkoutStatus.Cancelled },
      },
    });

    const result: {
      day: number;
      isAvailable: boolean;
      slots: { from: string; to: string; isAvailable: boolean }[];
    }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(year, month - 1, day));
      const dayOfWeek = DAYS_BY_JS_INDEX[date.getUTCDay()];
      const workingHour = workingHourByDay.get(dayOfWeek);

      if (!workingHour || workingHour.status !== WorkingHourStatus.Active) {
        result.push({ day, isAvailable: false, slots: [] });
        continue;
      }

      const bookedForDay = bookedWorkouts.filter(
        (workout) => workout.date.getTime() === date.getTime(),
      );
      const slots = this.computeSlots(workingHour, bookedForDay);
      result.push({
        day,
        isAvailable: slots.some((slot) => slot.isAvailable),
        slots,
      });
    }

    return result;
  }
}
