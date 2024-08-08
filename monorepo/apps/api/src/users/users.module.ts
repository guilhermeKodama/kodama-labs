import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserController } from './user.controller';
import { DatabaseModule } from 'src/database/database.module';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  imports: [DatabaseModule],
  providers: [UsersService, PrismaService],
  controllers: [UserController],
})
export class UsersModule {}
