import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateMessageDto } from './dto/create-message.dto';
import { GetConversationDto } from './dto/get-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { MessagesService } from './messages.service';

@Controller({ path: 'messages', version: '1' })
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Body() createMessageDto: CreateMessageDto,
  ) {
    return this.messagesService.create(request.user.sub, createMessageDto);
  }

  @Get('conversations')
  findConversations(
    @Req() request: Request & { user: JwtPayload },
    @Query() query: ListConversationsDto,
  ) {
    return this.messagesService.findConversationsForUser(
      request.user.sub,
      query.page ?? 1,
    );
  }

  @Get()
  findConversation(
    @Req() request: Request & { user: JwtPayload },
    @Query() query: GetConversationDto,
  ) {
    return this.messagesService.findConversation(
      request.user.sub,
      query.clientId,
      query.trainerId,
      query.page ?? 1,
    );
  }
}
