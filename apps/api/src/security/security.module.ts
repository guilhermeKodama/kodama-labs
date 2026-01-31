import { Module } from '@nestjs/common';
import { EncryptionService } from './services/encription.service';

@Module({
  providers: [EncryptionService],
})
export class SecurityModule {}
