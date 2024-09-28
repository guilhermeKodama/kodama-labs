import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GmailModule } from 'src/gmail/gmail.module';
import { GmailService } from 'src/gmail/gmail.service';
import { GoogleStrategy } from './passport/google.strategy';
import { NlpModule } from 'src/nlp/nlp.module';
import { NERService } from 'src/nlp/ner/ner.service';
import { UsersModule } from 'src/users/users.module';
import { UsersService } from 'src/users/services/users.service';
import { DatabaseModule } from 'src/database/database.module';
import { PrismaService } from 'src/database/prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './passport/jwt.strategy';
import { PassportModule } from '@nestjs/passport';
import { NubankNERService } from 'src/nlp/ner/nubank-ner.service';
import { XPNERService } from 'src/nlp/ner/xp-ner.service';
import { PdfService } from 'src/nlp/ner/pdf.service';
import { StorageModule } from 'src/storage/storage.module';
import { StorageService } from 'src/storage/services/storage.service';
import { TransactionsService } from 'src/users/services/transactios.service';
import { EventsGateway } from 'src/events/events.gateway';

@Module({
  imports: [
    StorageModule,
    GmailModule,
    NlpModule,
    UsersModule,
    DatabaseModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        return {
          secret: configService.get<string>('JWT_SECRET'),
          signOptions: {},
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GmailService,
    GoogleStrategy,
    NERService,
    NubankNERService,
    XPNERService,
    UsersService,
    PrismaService,
    JwtStrategy,
    PdfService,
    StorageService,
    TransactionsService,
    EventsGateway,
  ],
})
export class AuthModule {}
