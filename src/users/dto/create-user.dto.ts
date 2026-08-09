import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { Gender, UserType } from '../../../generated/prisma/client';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsPhoneNumber('TH')
  phone: string;

  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  age?: number;

  @IsEnum(Gender)
  gender: Gender;

  @IsEnum(UserType)
  type: UserType;

  @IsString()
  province: string;

  @IsString()
  district: string;

  @IsString()
  subDistrict: string;

  @IsString()
  postalCode: string;

  @IsOptional()
  @IsString()
  bankAccountNumber?: string;
}
