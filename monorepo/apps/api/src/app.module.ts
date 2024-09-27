import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { GmailModule } from './gmail/gmail.module';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './auth/passport/google.strategy';
import { NlpModule } from './nlp/nlp.module';
import { DatabaseModule } from './database/database.module';
import { SecurityModule } from './security/security.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production' ? '.env.production' : '.env',
    }),
    PassportModule.register({ session: true }),
    UsersModule,
    AuthModule,
    GmailModule,
    NlpModule,
    DatabaseModule,
    SecurityModule,
    StorageModule,
  ],
  controllers: [AppController],
  providers: [AppService, GoogleStrategy],
})
export class AppModule {}
