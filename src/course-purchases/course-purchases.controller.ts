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
import { CoursePurchasesService } from './course-purchases.service';
import { CreateCoursePurchaseDto } from './dto/create-course-purchase.dto';
import { PurchaseAndJoinDto } from './dto/purchase-and-join.dto';

@Controller({ version: '1' })
@UseGuards(JwtAuthGuard)
export class CoursePurchasesController {
  constructor(
    private readonly coursePurchasesService: CoursePurchasesService,
  ) {}

  @Post('trainer-courses/:courseId/purchase')
  purchase(
    @Req() request: Request & { user: JwtPayload },
    @Param('courseId') courseId: string,
    @Body() createCoursePurchaseDto: CreateCoursePurchaseDto,
  ) {
    return this.coursePurchasesService.purchase(
      request.user.sub,
      courseId,
      createCoursePurchaseDto,
    );
  }

  @Post('trainer-courses/:courseId/purchase-and-join')
  purchaseAndJoin(
    @Req() request: Request & { user: JwtPayload },
    @Param('courseId') courseId: string,
    @Body() purchaseAndJoinDto: PurchaseAndJoinDto,
  ) {
    return this.coursePurchasesService.purchaseAndJoin(
      request.user.sub,
      courseId,
      purchaseAndJoinDto,
    );
  }

  @Get('users/me/course-purchases')
  findMine(@Req() request: Request & { user: JwtPayload }) {
    return this.coursePurchasesService.findByClient(request.user.sub);
  }
}
