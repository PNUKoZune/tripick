import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FriendEntity } from '../friends/friend.entity';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { NotificationEntity } from './notification.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationEntity, FriendEntity]),
    UsersModule,
    NotificationModule,
    forwardRef(() => RealtimeModule),
  ],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
