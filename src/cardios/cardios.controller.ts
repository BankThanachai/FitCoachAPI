import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CardiosService } from './cardios.service';
import { CreateCardioDto } from './dto/create-cardio.dto';

@Controller({ path: 'cardios', version: '1' })
@UseGuards(JwtAuthGuard)
export class CardiosController {
  constructor(private readonly cardiosService: CardiosService) {}

  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Body() createCardioDto: CreateCardioDto,
  ) {
    return this.cardiosService.create(request.user.sub, createCardioDto);
  }

  @Get()
  findAll() {
    return this.cardiosService.findAll();
  }

  @Get('assigned/:userId')
  findByAssigned(@Param('userId') userId: string) {
    return this.cardiosService.findByAssigned(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.cardiosService.findOne(id);
  }
}
