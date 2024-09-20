import { IsString, IsNotEmpty } from 'class-validator';

export class UnlockPDFDto {
  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  transactionId: string;
}
