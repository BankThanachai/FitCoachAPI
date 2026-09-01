import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientTrainersModule } from '../client-trainers/client-trainers.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PaymentsModule } from '../payments/payments.module';
import { CoursePurchasesController } from './course-purchases.controller';
import { CoursePurchasesService } from './course-purchases.service';

@Module({
  imports: [AuthModule, CouponsModule, ClientTrainersModule, PaymentsModule],
  controllers: [CoursePurchasesController],
  providers: [CoursePurchasesService],
  exports: [CoursePurchasesService],
})
export class CoursePurchasesModule {}
