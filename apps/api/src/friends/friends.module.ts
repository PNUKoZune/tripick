import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxModule } from '../inbox/inbox.module';
import { UserEntity } from '../users/user.entity';
import { FriendsController } from './friends.controller';
import { FriendEntity } from './friend.entity';
import { FriendsService } from './friends.service';

@Module({
  imports: [TypeOrmModule.forFeature([FriendEntity, UserEntity]), InboxModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
