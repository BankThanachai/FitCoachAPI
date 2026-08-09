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
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@Controller({ path: 'users/me/bank-accounts', version: '1' })
@UseGuards(JwtAuthGuard)
export class BankAccountsController {
  constructor(private readonly bankAccountsService: BankAccountsService) {}

  @Post()
  create(
    @Req() request: Request & { user: JwtPayload },
    @Body() createBankAccountDto: CreateBankAccountDto,
  ) {
    return this.bankAccountsService.create(
      request.user.sub,
      createBankAccountDto,
    );
  }

  @Get()
  findAll(@Req() request: Request & { user: JwtPayload }) {
    return this.bankAccountsService.findAll(request.user.sub);
  }

  @Get(':id')
  findOne(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.bankAccountsService.findOne(request.user.sub, id);
  }

  @Patch(':id')
  update(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
    @Body() updateBankAccountDto: UpdateBankAccountDto,
  ) {
    return this.bankAccountsService.update(
      request.user.sub,
      id,
      updateBankAccountDto,
    );
  }

  @Delete(':id')
  remove(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.bankAccountsService.remove(request.user.sub, id);
  }
}
