import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ResendService } from './resend.service';
import { SmsModule } from './sms/sms.module';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({}), SmsModule],
  providers: [AuthService, JwtStrategy, ResendService],
  controllers: [AuthController],
  exports: [PassportModule, AuthService],
})
export class AuthModule {}
