import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FcmTokenEntity } from './fcm-token.entity';
import { FcmTokenService } from './fcm-token.service';
import { NotificationService } from './notification.service';

@Module({
  imports: [TypeOrmModule.forFeature([FcmTokenEntity])],
  providers: [NotificationService, FcmTokenService],
  exports: [NotificationService, FcmTokenService],
})
export class NotificationModule {}
