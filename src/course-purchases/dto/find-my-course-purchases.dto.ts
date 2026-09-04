import { IsOptional, IsUUID } from 'class-validator';

export class FindMyCoursePurchasesDto {
  @IsOptional()
  @IsUUID()
  trainerId?: string;
}
