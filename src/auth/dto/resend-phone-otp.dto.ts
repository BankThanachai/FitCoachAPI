import { IsPhoneNumber } from 'class-validator';

export class ResendPhoneOtpDto {
  @IsPhoneNumber('TH')
  phone: string;
}
