import {
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @ValidateIf((dto: LoginDto) => !dto.email)
  @IsPhoneNumber('TH')
  phone?: string;

  @ValidateIf((dto: LoginDto) => !dto.phone)
  @IsEmail()
  email?: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  fcmToken?: string;
}
