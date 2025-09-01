import { Module } from '@nestjs/common';
import { GmailService } from './gmail.service';
import { GmailController } from './gmail.controller';
import { NlpModule } from 'src/nlp/nlp.module';

@Module({
  imports: [NlpModule],
  providers: [GmailService],
  controllers: [GmailController],
})
export class GmailModule {}
