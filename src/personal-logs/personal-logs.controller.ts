import {
  Body,
  Controller,
  Delete,
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
import { PaginationQueryDto } from '../shared/dto/pagination-query.dto';
import { CreatePersonalLogDto } from './dto/create-personal-log.dto';
import { UpdatePersonalLogDto } from './dto/update-personal-log.dto';
import { PersonalLogsService } from './personal-logs.service';

@Controller({ path: 'personal-logs', version: '1' })
@UseGuards(JwtAuthGuard)
export class PersonalLogsController {
  constructor(private readonly personalLogsService: PersonalLogsService) {}

  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Body() createPersonalLogDto: CreatePersonalLogDto,
  ) {
    return this.personalLogsService.create(
      request.user.sub,
      createPersonalLogDto,
    );
  }

  @Get()
  findMine(
    @Req() request: Request & { user: JwtPayload },
    @Query() paginationQueryDto: PaginationQueryDto,
  ) {
    return this.personalLogsService.findByClient(
      request.user.sub,
      paginationQueryDto.page ?? 1,
      paginationQueryDto.pageSize ?? 20,
    );
  }

  @Get(':id')
  findOne(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.personalLogsService.findOne(id, request.user.sub);
  }

  @Patch(':id')
  update(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
    @Body() updatePersonalLogDto: UpdatePersonalLogDto,
  ) {
    return this.personalLogsService.update(
      id,
      request.user.sub,
      updatePersonalLogDto,
    );
  }

  @Delete(':id')
  remove(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.personalLogsService.remove(id, request.user.sub);
  }
}
