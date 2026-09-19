import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { OpnWebhookDto } from './dto/opn-webhook.dto';
import { SearchPaymentDto } from './dto/search-payment.dto';
import { PaymentsService } from './payments.service';

@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Body() createPaymentDto: CreatePaymentDto,
  ) {
    return this.paymentsService.create(request.user.sub, createPaymentDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  search(@Query() searchPaymentDto: SearchPaymentDto) {
    return this.paymentsService.search(searchPaymentDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  // Client polling endpoint for async (PromptPay) payments.
  @UseGuards(JwtAuthGuard)
  @Get(':chargeId/status')
  getStatus(
    @Req() request: Request & { user: JwtPayload },
    @Param('chargeId') chargeId: string,
  ) {
    return this.paymentsService.getStatus(chargeId, request.user.sub);
  }

  // Lets the client back out of a still-Pending PromptPay purchase instead
  // of waiting out the QR's expiry.
  @UseGuards(JwtAuthGuard)
  @Post(':chargeId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Req() request: Request & { user: JwtPayload },
    @Param('chargeId') chargeId: string,
  ) {
    return this.paymentsService.cancel(chargeId, request.user.sub);
  }

  // Opn calls this endpoint directly (no JWT). Verified server-side by
  // re-fetching the charge from the Omise API with the secret key
  // (PaymentsService.handleWebhookEvent) rather than trusting this payload,
  // since Omise's webhook product has no signature header to check.
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Body() body: OpnWebhookDto) {
    return this.paymentsService.handleWebhookEvent(
      body.key,
      body as unknown as Record<string, unknown>,
    );
  }
}
