import { IsPhoneNumber, IsString } from 'class-validator';

export class LoginDto {
  @IsPhoneNumber('TH')
  phone: string;

  @IsString()
  password: string;
}
