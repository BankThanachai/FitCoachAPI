import { IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdatePersonalLogDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
