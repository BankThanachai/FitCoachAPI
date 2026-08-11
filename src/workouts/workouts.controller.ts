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
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { GetAvailabilityDto } from './dto/get-availability.dto';
import { GetAvailabilityMonthDto } from './dto/get-availability-month.dto';
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
  findByClient(@Req() request: Request & { user: JwtPayload }) {
    return this.workoutsService.findByClient(request.user.sub);
  }

  @Get('trainer')
  findByTrainer(@Req() request: Request & { user: JwtPayload }) {
    return this.workoutsService.findByTrainer(request.user.sub);
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
}
