import { IsString } from 'class-validator';

export class ConfirmProfilePhotoDto {
  @IsString()
  key: string;
}
