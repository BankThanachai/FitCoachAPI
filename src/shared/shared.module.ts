import { Module } from '@nestjs/common';
import { CoursePurchaseCalculationsService } from './course-purchase-calculations.service';
import { R2Service } from './r2.service';

@Module({
  providers: [CoursePurchaseCalculationsService, R2Service],
  exports: [CoursePurchaseCalculationsService, R2Service],
})
export class SharedModule {}
