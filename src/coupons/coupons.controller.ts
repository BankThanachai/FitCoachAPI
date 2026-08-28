import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ListCouponsDto } from './dto/list-coupons.dto';

@Controller({ path: 'coupons', version: '1' })
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Post()
  create(@Body() createCouponDto: CreateCouponDto) {
    return this.couponsService.create(createCouponDto);
  }

  @Get('me')
  findMine(
    @Req() request: Request & { user: JwtPayload },
    @Query() query: ListCouponsDto,
  ) {
    return this.couponsService.findByClient(request.user.sub, query.page ?? 1);
  }
}
