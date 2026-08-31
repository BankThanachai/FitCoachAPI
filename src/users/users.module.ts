import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CouponsModule } from '../coupons/coupons.module';
import { WorkingHoursModule } from '../working-hours/working-hours.module';
import { BankAccountsController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, WorkingHoursModule, CouponsModule],
  controllers: [UsersController, BankAccountsController],
  providers: [UsersService, BankAccountsService],
})
export class UsersModule {}
