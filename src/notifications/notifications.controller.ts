import { Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { NotificationsService } from './notifications.service';

@Controller({ path: 'notifications', version: '1' })
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findMine(@Req() request: Request & { user: JwtPayload }) {
    return this.notificationsService.findByUser(request.user.sub);
  }

  @Get('unread-count')
  countUnread(@Req() request: Request & { user: JwtPayload }) {
    return this.notificationsService.countUnread(request.user.sub);
  }

  @Patch(':id/read')
  markAsRead(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(request.user.sub, id);
  }

  @Patch('read-all')
  markAllAsRead(@Req() request: Request & { user: JwtPayload }) {
    return this.notificationsService.markAllAsRead(request.user.sub);
  }
}
