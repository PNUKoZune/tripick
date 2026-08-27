import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '../notification/notification.module';
import { StorageModule } from '../storage/storage.module';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity';
import { EmailTokenEntity } from '../auth/entities/email-token.entity';
import { PreferenceEntity } from '../preferences/preference.entity';
import { UserEntity } from './user.entity';
import { WithdrawalReasonEntity } from './withdrawal-reason.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    // refresh·email 토큰은 users FK 가 없어 탈퇴 시 직접 지워야 한다(UsersService.removeUser).
    // preferences 는 FK CASCADE 로 지워지지만, 그 안의 photoUrls 가 가리키는 스토리지
    // 오브젝트는 DB 밖이라 아무도 안 지운다 — 키를 읽으려고 레포만 등록한다(서비스 의존 X).
    TypeOrmModule.forFeature([
      UserEntity,
      WithdrawalReasonEntity,
      RefreshTokenEntity,
      EmailTokenEntity,
      PreferenceEntity,
    ]),
    StorageModule,
    NotificationModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
