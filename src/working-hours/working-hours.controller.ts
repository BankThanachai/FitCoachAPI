import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateWorkingHourDto } from './dto/create-working-hour.dto';
import { UpdateWorkingHourDto } from './dto/update-working-hour.dto';
import { WorkingHoursService } from './working-hours.service';

@Controller({ path: 'users/me/working-hours', version: '1' })
@UseGuards(JwtAuthGuard)
export class WorkingHoursController {
  constructor(private readonly workingHoursService: WorkingHoursService) {}

  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Body() createWorkingHourDto: CreateWorkingHourDto,
  ) {
    return this.workingHoursService.create(
      request.user.sub,
      createWorkingHourDto,
    );
  }

  @Get()
  findAll(@Req() request: Request & { user: JwtPayload }) {
    return this.workingHoursService.findByUser(request.user.sub);
  }

  @Patch(':id')
  update(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
    @Body() updateWorkingHourDto: UpdateWorkingHourDto,
  ) {
    return this.workingHoursService.update(
      request.user.sub,
      id,
      updateWorkingHourDto,
    );
  }
}
