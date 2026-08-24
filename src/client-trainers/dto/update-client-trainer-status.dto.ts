import { IsEnum } from 'class-validator';
import { ClientTrainerStatus } from '../../../generated/prisma/client';

export class UpdateClientTrainerStatusDto {
  @IsEnum(ClientTrainerStatus)
  status: ClientTrainerStatus;
}
