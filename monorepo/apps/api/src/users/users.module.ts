import { Module } from '@nestjs/common';
import { UsersService } from './services/users.service';
import { UserController } from './user.controller';
import { DatabaseModule } from 'src/database/database.module';
import { PrismaService } from 'src/database/prisma.service';
import { SecurityModule } from 'src/security/security.module';
import { EncryptionService } from 'src/security/services/encription.service';
import { PdfService } from 'src/nlp/ner/pdf.service';
import { NlpModule } from 'src/nlp/nlp.module';
import { StorageModule } from 'src/storage/storage.module';
import { StorageService } from 'src/storage/services/storage.service';
import { TransactionsService } from './services/transactios.service';
import { NERService } from 'src/nlp/ner/ner.service';
import { XPNERService } from 'src/nlp/ner/xp-ner.service';
import { NubankNERService } from 'src/nlp/ner/nubank-ner.service';

@Module({
  imports: [DatabaseModule, SecurityModule, NlpModule, StorageModule],
  providers: [
    UsersService,
    PrismaService,
    EncryptionService,
    PdfService,
    StorageService,
    TransactionsService,
    NERService,
    XPNERService,
    NubankNERService,
  ],
  controllers: [UserController],
})
export class UsersModule {}
