import { Module } from '@nestjs/common';
import { CoursePurchaseCalculationsService } from './course-purchase-calculations.service';

@Module({
  providers: [CoursePurchaseCalculationsService],
  exports: [CoursePurchaseCalculationsService],
})
export class SharedModule {}
