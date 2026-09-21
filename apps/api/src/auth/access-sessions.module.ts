import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessSessionsService } from './access-sessions.service';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserEntity } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RefreshTokenEntity, UserEntity])],
  providers: [AccessSessionsService],
  exports: [AccessSessionsService],
})
export class AccessSessionsModule {}
