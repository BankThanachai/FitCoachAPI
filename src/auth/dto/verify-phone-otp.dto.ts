import { IsPhoneNumber, Matches } from 'class-validator';

export class VerifyPhoneOtpDto {
  @IsPhoneNumber('TH')
  phone: string;

  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code: string;
}
