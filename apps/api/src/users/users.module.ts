import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '../notification/notification.module';
import { StorageModule } from '../storage/storage.module';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity';
import { EmailTokenEntity } from '../auth/entities/email-token.entity';
import { UserEntity } from './user.entity';
import { WithdrawalReasonEntity } from './withdrawal-reason.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    // refresh·email 토큰은 users FK 가 없어 탈퇴 시 직접 지워야 한다(UsersService.removeUser).
    TypeOrmModule.forFeature([
      UserEntity,
      WithdrawalReasonEntity,
      RefreshTokenEntity,
      EmailTokenEntity,
    ]),
    StorageModule,
    NotificationModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
