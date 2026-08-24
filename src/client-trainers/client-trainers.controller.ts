import {
  Body,
  Controller,
  Delete,
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
import { ClientTrainersService } from './client-trainers.service';
import { CreateClientTrainerDto } from './dto/create-client-trainer.dto';
import { UpdateClientTrainerStatusDto } from './dto/update-client-trainer-status.dto';

@Controller({ path: 'client-trainers', version: '1' })
@UseGuards(JwtAuthGuard)
export class ClientTrainersController {
  constructor(private readonly clientTrainersService: ClientTrainersService) {}

  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Body() createClientTrainerDto: CreateClientTrainerDto,
  ) {
    return this.clientTrainersService.create(
      request.user.sub,
      createClientTrainerDto,
    );
  }

  @Get('my-trainers')
  findByClient(@Req() request: Request & { user: JwtPayload }) {
    return this.clientTrainersService.findByClient(request.user.sub);
  }

  @Get('my-clients')
  findByTrainer(@Req() request: Request & { user: JwtPayload }) {
    return this.clientTrainersService.findByTrainer(request.user.sub);
  }

  @Patch(':clientId/status')
  updateStatus(
    @Req() request: Request & { user: JwtPayload },
    @Param('clientId') clientId: string,
    @Body() updateClientTrainerStatusDto: UpdateClientTrainerStatusDto,
  ) {
    return this.clientTrainersService.updateStatus(
      request.user.sub,
      clientId,
      updateClientTrainerStatusDto,
    );
  }

  @Delete(':trainerId')
  remove(
    @Req() request: Request & { user: JwtPayload },
    @Param('trainerId') trainerId: string,
  ) {
    return this.clientTrainersService.remove(request.user.sub, trainerId);
  }
}
