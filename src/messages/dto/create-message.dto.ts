import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateMessageDto {
  @IsUUID()
  clientId: string;

  @IsUUID()
  trainerId: string;

  @IsString()
  @IsNotEmpty()
  content: string;
}
