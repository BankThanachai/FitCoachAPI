import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClientTrainerStatus,
  DayOfWeek,
  NotificationType,
  Prisma,
  UserType,
  WorkingHourStatus,
  Workout,
  WorkoutStatus,
} from '../../generated/prisma/client';
import { CoursePurchasesService } from '../course-purchases/course-purchases.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeFullName, withFullName } from '../shared/name.util';
import { paginate } from '../shared/pagination.util';
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

const WORKOUT_INCLUDE = {
  trainer: { select: { id: true, firstName: true, lastName: true } },
  client: { select: { id: true, firstName: true, lastName: true } },
  exercises: { include: { sets: true } },
} as const;

function serialize<
  T extends Workout & {
    trainer?: { firstName: string | null; lastName: string | null };
    client?: { firstName: string | null; lastName: string | null };
  },
>(workout: T) {
  const { trainer, client, ...rest } = workout;
  return {
    ...rest,
    ...(trainer ? { trainer: withFullName(trainer) } : {}),
    ...(client ? { client: withFullName(client) } : {}),
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
    private readonly coursePurchasesService: CoursePurchasesService,
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

    await this.coursePurchasesService.ensureUsable(
      createWorkoutDto.purchaseId,
      createWorkoutDto.clientId,
      createWorkoutDto.trainerId,
    );

    const workout = await this.prisma.workout.create({
      data: {
        trainerId: createWorkoutDto.trainerId,
        clientId: createWorkoutDto.clientId,
        purchaseId: createWorkoutDto.purchaseId,
        date,
        fromTime,
        toTime,
      },
    });

    await this.notificationsService.create({
      userId: createWorkoutDto.trainerId,
      type: NotificationType.Workout,
      title: 'New workout booked',
      body: `${computeFullName(client.firstName, client.lastName) ?? 'A client'} booked a workout on ${createWorkoutDto.date} ${createWorkoutDto.fromTime} - ${createWorkoutDto.toTime}`,
      entityType: 'Workout',
      entityId: workout.id,
    });

    return serialize(workout);
  }

  async findAll() {
    const workouts = await this.prisma.workout.findMany({
      include: WORKOUT_INCLUDE,
      orderBy: [{ date: 'desc' }, { fromTime: 'asc' }],
    });
    return workouts.map(serialize);
  }

  async findByClient(
    clientId: string,
    page: number,
    pageSize: number,
    purchaseId?: string,
    date?: string,
    sortOrder: 'asc' | 'desc' = 'desc',
    dateFrom?: string,
  ) {
    const where: Prisma.WorkoutWhereInput = {
      clientId,
      purchaseId,
      date: date
        ? new Date(date)
        : dateFrom
          ? { gt: new Date(dateFrom) }
          : undefined,
    };
    const [workouts, total] = await Promise.all([
      this.prisma.workout.findMany({
        where,
        include: WORKOUT_INCLUDE,
        orderBy: [{ date: sortOrder }, { fromTime: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.workout.count({ where }),
    ]);
    return paginate(workouts.map(serialize), page, pageSize, total);
  }

  async findByTrainer(
    trainerId: string,
    page: number,
    pageSize: number,
    date?: string,
    dateFrom?: string,
    dateTo?: string,
    clientName?: string,
  ) {
    const where: Prisma.WorkoutWhereInput = {
      trainerId,
      date: date
        ? new Date(date)
        : dateFrom || dateTo
          ? {
              gte: dateFrom ? new Date(dateFrom) : undefined,
              lte: dateTo ? new Date(dateTo) : undefined,
            }
          : undefined,
      client: clientName
        ? {
            OR: [
              { firstName: { contains: clientName, mode: 'insensitive' } },
              { lastName: { contains: clientName, mode: 'insensitive' } },
            ],
          }
        : undefined,
    };
    const [workouts, total] = await Promise.all([
      this.prisma.workout.findMany({
        where,
        include: WORKOUT_INCLUDE,
        orderBy: [{ date: 'desc' }, { fromTime: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.workout.count({ where }),
    ]);
    return paginate(workouts.map(serialize), page, pageSize, total);
  }

  /**
   * Workouts between the requesting trainer and one specific client of
   * theirs. Verifies an Accepted ClientTrainer relation exists between
   * them first — a trainer can't look up a client they aren't actually
   * connected to.
   */
  async findMyClientWorkouts(trainerId: string, clientId: string) {
    const relation = await this.prisma.clientTrainer.findFirst({
      where: {
        trainerId,
        clientId,
        status: ClientTrainerStatus.Accepted,
      },
    });
    if (!relation) {
      throw new ForbiddenException('This client is not one of yours');
    }

    const workouts = await this.prisma.workout.findMany({
      where: { trainerId, clientId },
      include: WORKOUT_INCLUDE,
      orderBy: [{ date: 'desc' }, { fromTime: 'asc' }],
    });
    return workouts.map(serialize);
  }

  async findOne(id: string) {
    const workout = await this.prisma.workout.findUnique({
      where: { id },
      include: WORKOUT_INCLUDE,
    });
    if (!workout) {
      throw new NotFoundException(`Workout with id ${id} not found`);
    }
    return serialize(workout);
  }

  /**
   * Trainer approves a client's booking request, moving it from
   * PendingApproval to TrainerApproved. Only the trainer on the workout
   * may call this, and only from PendingApproval.
   */
  async approveBooking(id: string, trainerId: string) {
    const workout = await this.prisma.workout.findUnique({ where: { id } });
    if (!workout) {
      throw new NotFoundException(`Workout with id ${id} not found`);
    }
    if (workout.trainerId !== trainerId) {
      throw new ForbiddenException(
        'Only the trainer on this workout can approve it',
      );
    }

    const { count } = await this.prisma.workout.updateMany({
      where: { id, status: WorkoutStatus.PendingApproval },
      data: { status: WorkoutStatus.TrainerApproved },
    });
    if (count === 0) {
      throw new BadRequestException(
        'Only a workout pending approval can be approved',
      );
    }

    await this.notificationsService.create({
      userId: workout.clientId,
      type: NotificationType.Workout,
      title: 'Workout confirmed',
      body: `Your workout on ${serialize(workout).date} has been confirmed`,
      entityType: 'Workout',
      entityId: workout.id,
    });

    return this.findOne(id);
  }

  /**
   * Trainer rejects a client's booking request, moving it from
   * PendingApproval to TrainerRejected — a dead end, distinct from
   * Cancelled. A reason is required and stored on the workout so the
   * client can see why. Only the trainer on the workout may call this,
   * and only from PendingApproval.
   */
  async rejectBooking(id: string, trainerId: string, reason: string) {
    const workout = await this.prisma.workout.findUnique({ where: { id } });
    if (!workout) {
      throw new NotFoundException(`Workout with id ${id} not found`);
    }
    if (workout.trainerId !== trainerId) {
      throw new ForbiddenException(
        'Only the trainer on this workout can reject it',
      );
    }

    const { count } = await this.prisma.workout.updateMany({
      where: { id, status: WorkoutStatus.PendingApproval },
      data: { status: WorkoutStatus.TrainerRejected, rejectReason: reason },
    });
    if (count === 0) {
      throw new BadRequestException(
        'Only a workout pending approval can be rejected',
      );
    }

    await this.notificationsService.create({
      userId: workout.clientId,
      type: NotificationType.Workout,
      title: 'Workout request declined',
      body: `Your workout request on ${serialize(workout).date} was declined by the trainer: ${reason}`,
      entityType: 'Workout',
      entityId: workout.id,
    });

    return this.findOne(id);
  }

  /**
   * Trainer finishes training the client and submits the session for the
   * client to review, moving it from TrainerApproved to TrainerSubmitted.
   * Only the trainer on the workout may call this, and only from
   * TrainerApproved.
   */
  async submitTraining(id: string, trainerId: string) {
    const workout = await this.prisma.workout.findUnique({ where: { id } });
    if (!workout) {
      throw new NotFoundException(`Workout with id ${id} not found`);
    }
    if (workout.trainerId !== trainerId) {
      throw new ForbiddenException(
        'Only the trainer on this workout can submit it',
      );
    }

    const { count } = await this.prisma.workout.updateMany({
      where: { id, status: WorkoutStatus.TrainerApproved },
      data: { status: WorkoutStatus.TrainerSubmitted },
    });
    if (count === 0) {
      throw new BadRequestException(
        'Only an approved workout can be submitted',
      );
    }

    await this.notificationsService.create({
      userId: workout.clientId,
      type: NotificationType.Workout,
      title: 'Workout awaiting your review',
      body: `Your trainer submitted the workout on ${serialize(workout).date} — please review it`,
      entityType: 'Workout',
      entityId: workout.id,
    });

    return this.findOne(id);
  }

  /**
   * Client approves the trainer's submitted session, moving it from
   * TrainerSubmitted to Completed. Only the client on the workout may
   * call this, and only from TrainerSubmitted.
   */
  async approveSubmission(id: string, clientId: string) {
    const workout = await this.prisma.workout.findUnique({ where: { id } });
    if (!workout) {
      throw new NotFoundException(`Workout with id ${id} not found`);
    }
    if (workout.clientId !== clientId) {
      throw new ForbiddenException(
        'Only the client on this workout can approve it',
      );
    }

    const { count } = await this.prisma.workout.updateMany({
      where: { id, status: WorkoutStatus.TrainerSubmitted },
      data: { status: WorkoutStatus.Completed },
    });
    if (count === 0) {
      throw new BadRequestException('Only a submitted workout can be approved');
    }

    await this.notificationsService.create({
      userId: workout.trainerId,
      type: NotificationType.Workout,
      title: 'Workout approved',
      body: `The client approved the workout on ${serialize(workout).date}`,
      entityType: 'Workout',
      entityId: workout.id,
    });

    return this.findOne(id);
  }

  /**
   * Client disputes the trainer's submitted session, moving it from
   * TrainerSubmitted to ClientRejected — a dead end. A reason is required
   * and stored on the workout. Only the client on the workout may call
   * this, and only from TrainerSubmitted.
   */
  async rejectSubmission(id: string, clientId: string, reason: string) {
    const workout = await this.prisma.workout.findUnique({ where: { id } });
    if (!workout) {
      throw new NotFoundException(`Workout with id ${id} not found`);
    }
    if (workout.clientId !== clientId) {
      throw new ForbiddenException(
        'Only the client on this workout can reject it',
      );
    }

    const { count } = await this.prisma.workout.updateMany({
      where: { id, status: WorkoutStatus.TrainerSubmitted },
      data: { status: WorkoutStatus.ClientRejected, rejectReason: reason },
    });
    if (count === 0) {
      throw new BadRequestException('Only a submitted workout can be rejected');
    }

    await this.notificationsService.create({
      userId: workout.trainerId,
      type: NotificationType.Workout,
      title: 'Workout submission declined',
      body: `The client declined the workout submission on ${serialize(workout).date}: ${reason}`,
      entityType: 'Workout',
      entityId: workout.id,
    });

    return this.findOne(id);
  }

  /**
   * Either the client or the trainer on a workout cancels it, from any
   * non-terminal status. Unlike the generic PATCH :id, this checks the
   * caller is actually a party to the workout.
   */
  async cancelWorkout(id: string, userId: string, reason?: string) {
    const workout = await this.prisma.workout.findUnique({ where: { id } });
    if (!workout) {
      throw new NotFoundException(`Workout with id ${id} not found`);
    }
    if (workout.clientId !== userId && workout.trainerId !== userId) {
      throw new ForbiddenException(
        'Only the client or trainer on this workout can cancel it',
      );
    }

    const { count } = await this.prisma.workout.updateMany({
      where: {
        id,
        status: {
          in: [
            WorkoutStatus.PendingApproval,
            WorkoutStatus.TrainerApproved,
            WorkoutStatus.TrainerSubmitted,
          ],
        },
      },
      data: { status: WorkoutStatus.Cancelled, rejectReason: reason },
    });
    if (count === 0) {
      throw new BadRequestException(
        'This workout is already finished and cannot be cancelled',
      );
    }

    const otherPartyId =
      workout.clientId === userId ? workout.trainerId : workout.clientId;
    await this.notificationsService.create({
      userId: otherPartyId,
      type: NotificationType.Workout,
      title: 'Workout cancelled',
      body: reason
        ? `The workout on ${serialize(workout).date} was cancelled: ${reason}`
        : `The workout on ${serialize(workout).date} was cancelled`,
      entityType: 'Workout',
      entityId: workout.id,
    });

    return this.findOne(id);
  }

  /**
   * Edits a workout's date/time. Status is not settable through this
   * generic PATCH — every status transition goes through a dedicated
   * endpoint (approveBooking/rejectBooking/submitTraining/
   * approveSubmission/rejectSubmission/cancelWorkout) that checks the
   * caller's role, which a bare PATCH can't express.
   */
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
      data: { date, fromTime, toTime },
    });

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
        status: {
          notIn: [WorkoutStatus.Cancelled, WorkoutStatus.TrainerRejected],
        },
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
        status: {
          notIn: [WorkoutStatus.Cancelled, WorkoutStatus.TrainerRejected],
        },
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
