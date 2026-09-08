import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SharedModule } from '../shared/shared.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [AuthModule, SharedModule],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
