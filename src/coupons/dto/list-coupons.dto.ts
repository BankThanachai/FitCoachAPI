import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class ListCouponsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /**
   * Narrows to coupons with any of these derived statuses — omit for every
   * status. Accepts a single value (`status=Active`) or repeated ones
   * (`status=Used&status=Expired`, arriving as a string here that a lone
   * query param wouldn't produce as an array).
   */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsIn(['Active', 'Used', 'Expired'], { each: true })
  status?: ('Active' | 'Used' | 'Expired')[];
}
