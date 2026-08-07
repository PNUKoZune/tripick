import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TripMembersModule } from '../trip-members/trip-members.module';
import { accessTokenSecret } from '../common/jwt-secrets';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    forwardRef(() => TripMembersModule),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: accessTokenSecret(config),
      }),
    }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
