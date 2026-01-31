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
import { EventsModule } from './events/events.module';
import { EventsGateway } from './events/events.gateway';

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
    EventsModule,
  ],
  controllers: [AppController],
  providers: [AppService, GoogleStrategy, EventsGateway],
})
export class AppModule {}
