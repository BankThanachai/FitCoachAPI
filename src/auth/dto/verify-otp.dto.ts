import { IsEmail, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsEmail()
  email: string;

  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code: string;
}
