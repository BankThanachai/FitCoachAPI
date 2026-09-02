import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SharedModule } from '../shared/shared.module';
import { ClientTrainersController } from './client-trainers.controller';
import { ClientTrainersService } from './client-trainers.service';

@Module({
  imports: [AuthModule, NotificationsModule, SharedModule],
  controllers: [ClientTrainersController],
  providers: [ClientTrainersService],
  exports: [ClientTrainersService],
})
export class ClientTrainersModule {}
