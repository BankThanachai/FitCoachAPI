import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { R2Service } from './r2.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [UploadsService, R2Service],
})
export class UploadsModule {}
