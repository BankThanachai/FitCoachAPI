import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OmiseService } from './omise.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, OmiseService],
  exports: [PaymentsService, OmiseService],
})
export class PaymentsModule {}
