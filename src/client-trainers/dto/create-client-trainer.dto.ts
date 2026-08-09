import { IsUUID } from 'class-validator';

export class CreateClientTrainerDto {
  @IsUUID()
  trainerId: string;
}
