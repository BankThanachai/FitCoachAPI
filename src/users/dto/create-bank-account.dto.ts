import { IsString } from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  bankName: string;

  @IsString()
  accountNumber: string;
}
