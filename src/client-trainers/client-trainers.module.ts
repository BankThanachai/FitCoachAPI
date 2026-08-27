import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClientTrainersController } from './client-trainers.controller';
import { ClientTrainersService } from './client-trainers.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ClientTrainersController],
  providers: [ClientTrainersService],
})
export class ClientTrainersModule {}
