import { Module } from '@nestjs/common';
import { StorageService } from './services/storage.service';

@Module({
  providers: [StorageService],
})
export class StorageModule {}
