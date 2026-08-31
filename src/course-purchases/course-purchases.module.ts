import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CouponsModule } from '../coupons/coupons.module';
import { CoursePurchasesController } from './course-purchases.controller';
import { CoursePurchasesService } from './course-purchases.service';

@Module({
  imports: [AuthModule, CouponsModule],
  controllers: [CoursePurchasesController],
  providers: [CoursePurchasesService],
  exports: [CoursePurchasesService],
})
export class CoursePurchasesModule {}
