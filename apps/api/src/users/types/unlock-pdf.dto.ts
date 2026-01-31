import { IsString, IsNotEmpty } from 'class-validator';

export class UnlockPDFDto {
  @IsString()
  @IsNotEmpty()
  emailId: string;

  @IsString()
  @IsNotEmpty()
  updateUserId: string;
}
