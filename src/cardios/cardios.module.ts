import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CardiosController } from './cardios.controller';
import { CardiosService } from './cardios.service';

@Module({
  imports: [AuthModule],
  controllers: [CardiosController],
  providers: [CardiosService],
})
export class CardiosModule {}
