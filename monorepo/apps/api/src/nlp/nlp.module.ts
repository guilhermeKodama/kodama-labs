import { Module } from '@nestjs/common';
import { NERService } from './ner/ner.service';

@Module({
  providers: [NERService],
})
export class NlpModule {}
