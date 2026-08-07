import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { KakaoExchangeService } from './kakao-exchange.service';
import { EmailSendLimiterService } from './email-send-limiter.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { EmailTokenEntity } from './entities/email-token.entity';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';
import { accessTokenSecret } from '../common/jwt-secrets';

@Module({
  imports: [
    UsersModule,
    EmailModule,
    PassportModule,
    TypeOrmModule.forFeature([RefreshTokenEntity, EmailTokenEntity]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: accessTokenSecret(config),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, KakaoExchangeService, EmailSendLimiterService],
  exports: [AuthService],
})
export class AuthModule {}
