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
import { CreateReviewDto } from './dto/create-review.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';
import { ReviewsService } from './reviews.service';

@Controller({ path: 'reviews', version: '1' })
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Body() createReviewDto: CreateReviewDto,
  ) {
    return this.reviewsService.create(request.user.sub, createReviewDto);
  }

  @Post(':id/reply')
  reply(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
    @Body() replyReviewDto: ReplyReviewDto,
  ) {
    return this.reviewsService.reply(id, request.user.sub, replyReviewDto);
  }

  @Get('user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.reviewsService.findByUser(userId);
  }
}
