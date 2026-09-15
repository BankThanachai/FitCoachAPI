import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CancelWorkoutDto } from './dto/cancel-workout.dto';
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { FindClientWorkoutsDto } from './dto/find-client-workouts.dto';
import { FindTrainerWorkoutsDto } from './dto/find-trainer-workouts.dto';
import { GetAvailabilityDto } from './dto/get-availability.dto';
import { GetAvailabilityMonthDto } from './dto/get-availability-month.dto';
import { RejectWorkoutDto } from './dto/reject-workout.dto';
import { UpdateWorkoutDto } from './dto/update-workout.dto';
import { WorkoutsService } from './workouts.service';

@Controller({ path: 'workouts', version: '1' })
@UseGuards(JwtAuthGuard)
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  create(@Body() createWorkoutDto: CreateWorkoutDto) {
    return this.workoutsService.create(createWorkoutDto);
  }

  @Get()
  findAll() {
    return this.workoutsService.findAll();
  }

  @Get('client')
  findByClient(
    @Req() request: Request & { user: JwtPayload },
    @Query() query: FindClientWorkoutsDto,
  ) {
    return this.workoutsService.findByClient(
      request.user.sub,
      query.page ?? 1,
      query.pageSize ?? 20,
      query.purchaseId,
      query.date,
      query.sortOrder,
      query.dateFrom,
    );
  }

  @Get('trainer')
  findByTrainer(
    @Req() request: Request & { user: JwtPayload },
    @Query() query: FindTrainerWorkoutsDto,
  ) {
    return this.workoutsService.findByTrainer(
      request.user.sub,
      query.page ?? 1,
      query.pageSize ?? 20,
      query.date,
      query.dateFrom,
      query.dateTo,
      query.clientName,
      query.status,
    );
  }

  @Get('my-clients/:clientId')
  findMyClientWorkouts(
    @Req() request: Request & { user: JwtPayload },
    @Param('clientId') clientId: string,
  ) {
    return this.workoutsService.findMyClientWorkouts(
      request.user.sub,
      clientId,
    );
  }

  @Get('availability/:trainerId')
  getAvailableTimeOnDate(
    @Param('trainerId') trainerId: string,
    @Query() getAvailabilityDto: GetAvailabilityDto,
  ) {
    return this.workoutsService.getAvailableTimeOnDate(
      trainerId,
      getAvailabilityDto.date,
    );
  }

  @Get('availability/:trainerId/month')
  getAvailableOnMonth(
    @Param('trainerId') trainerId: string,
    @Query() getAvailabilityMonthDto: GetAvailabilityMonthDto,
  ) {
    return this.workoutsService.getAvailableOnMonth(
      trainerId,
      getAvailabilityMonthDto.month,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workoutsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateWorkoutDto: UpdateWorkoutDto) {
    return this.workoutsService.update(id, updateWorkoutDto);
  }

  @Post(':id/approve-booking')
  approveBooking(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.workoutsService.approveBooking(id, request.user.sub);
  }

  @Post(':id/reject-booking')
  rejectBooking(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
    @Body() rejectWorkoutDto: RejectWorkoutDto,
  ) {
    return this.workoutsService.rejectBooking(
      id,
      request.user.sub,
      rejectWorkoutDto.reason,
    );
  }

  @Post(':id/submit')
  submitTraining(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.workoutsService.submitTraining(id, request.user.sub);
  }

  @Post(':id/approve-submission')
  approveSubmission(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.workoutsService.approveSubmission(id, request.user.sub);
  }

  @Post(':id/reject-submission')
  rejectSubmission(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
    @Body() rejectWorkoutDto: RejectWorkoutDto,
  ) {
    return this.workoutsService.rejectSubmission(
      id,
      request.user.sub,
      rejectWorkoutDto.reason,
    );
  }

  @Post(':id/cancel')
  cancelWorkout(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
    @Body() cancelWorkoutDto: CancelWorkoutDto,
  ) {
    return this.workoutsService.cancelWorkout(
      id,
      request.user.sub,
      cancelWorkoutDto.reason,
    );
  }
}
