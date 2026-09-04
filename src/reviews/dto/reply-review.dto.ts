import { IsString, MinLength } from 'class-validator';

export class ReplyReviewDto {
  @IsString()
  @MinLength(1)
  reply: string;
}
