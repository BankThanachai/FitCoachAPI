import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { RevenueCatWebhookDto } from './dto/revenuecat-webhook.dto';
import { RevenueCatWebhookGuard } from './revenuecat-webhook.guard';
import { SubscriptionsService } from './subscriptions.service';

@Controller({ path: 'subscriptions', version: '1' })
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // Own subscription details only. These deliberately aren't on GET
  // /users/:id — that endpoint doesn't check who is asking, so the expiry
  // date, store and status would be readable by any logged-in user.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMine(@Req() request: Request & { user: JwtPayload }) {
    return this.subscriptionsService.getMine(request.user.sub);
  }

  // The app calls this right after a purchase or restore, so it doesn't see
  // Pro from the RevenueCat SDK while the webhook is still on its way.
  @UseGuards(JwtAuthGuard)
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  sync(@Req() request: Request & { user: JwtPayload }) {
    return this.subscriptionsService.syncFromRevenueCat(request.user.sub);
  }

  // RevenueCat calls this directly (no JWT) — authenticated by the shared
  // Authorization header value instead.
  @UseGuards(RevenueCatWebhookGuard)
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Body() body: RevenueCatWebhookDto) {
    return this.subscriptionsService.handleWebhookEvent(body);
  }
}
