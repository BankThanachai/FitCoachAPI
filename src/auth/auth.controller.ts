import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthThrottlerGuard } from '../shared/auth-throttler.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ResendPhoneOtpDto } from './dto/resend-phone-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';

// Rate-limited per IP (10 requests/minute, then blocked for 30 minutes —
// see the 'auth' throttler in AppModule) on every route in this
// controller. This is on top of, not instead of, AuthService's per-account
// login lockout — the IP limit stops one IP from hammering many accounts
// (credential stuffing) or spamming OTP sends; the account lockout stops
// repeated guesses against one specific account regardless of which IP
// they come from. Must match AppModule's ThrottlerModule.forRoot config —
// @Throttle here overrides it per-route, so a mismatch would silently
// apply different limits than the ones documented for mobile.
@UseGuards(AuthThrottlerGuard)
@Throttle({ auth: { ttl: 60_000, limit: 10, blockDuration: 30 * 60_000 } })
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyEmailOtp(
      verifyOtpDto.email,
      verifyOtpDto.code,
    );
  }

  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() resendOtpDto: ResendOtpDto) {
    await this.authService.resendEmailOtp(resendOtpDto.email);
    return { success: true };
  }

  @Post('otp/phone/verify')
  @HttpCode(HttpStatus.OK)
  verifyPhoneOtp(@Body() verifyPhoneOtpDto: VerifyPhoneOtpDto) {
    return this.authService.verifyPhoneOtp(
      verifyPhoneOtpDto.phone,
      verifyPhoneOtpDto.code,
    );
  }

  @Post('otp/phone/resend')
  @HttpCode(HttpStatus.OK)
  async resendPhoneOtp(@Body() resendPhoneOtpDto: ResendPhoneOtpDto) {
    await this.authService.resendPhoneOtp(resendPhoneOtpDto.phone);
    return { success: true };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refresh(refreshTokenDto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() refreshTokenDto: RefreshTokenDto) {
    await this.authService.logout(refreshTokenDto.refreshToken);
    return { success: true };
  }
}
