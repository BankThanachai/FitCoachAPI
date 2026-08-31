import { ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

export class CreateCoursePurchaseDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  couponIds?: string[];
}
