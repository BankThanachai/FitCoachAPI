import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Gender, UserType } from '../../../generated/prisma/client';
import { CreateBankAccountDto } from './create-bank-account.dto';

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
  @IsISO8601()
  birthDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  heightCm?: number;

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
  @ValidateNested({ each: true })
  @Type(() => CreateBankAccountDto)
  bankAccounts?: CreateBankAccountDto[];
}
