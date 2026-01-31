import { IsString, IsNotEmpty } from 'class-validator';

export class SetPDFDto {
  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  transactionId: string;
}
