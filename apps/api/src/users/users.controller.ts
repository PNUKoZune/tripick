import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UserEntity } from './user.entity';
import type {
  UpdateNotificationPreferencesDto,
  UpdateUserDto,
} from '@tripick/types';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: '내 프로필 조회' })
  getMe(@CurrentUser() user: UserEntity) {
    return user;
  }

  @Patch('me')
  @ApiOperation({ summary: '내 프로필 수정' })
  updateMe(@CurrentUser() user: UserEntity, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user.id, dto);
  }

  @Patch('me/notification-preferences')
  @ApiOperation({ summary: '알림 수신 설정 갱신' })
  updateNotificationPreferences(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.usersService.updateNotificationPreferences(
      user.id,
      dto?.preferences ?? {},
    );
  }

  @Patch('me/fcm-token')
  @ApiOperation({ summary: 'FCM 토큰 등록/갱신' })
  async updateFcmToken(
    @CurrentUser() user: UserEntity,
    @Body('fcmToken') fcmToken: string,
  ) {
    await this.usersService.updateFcmToken(user.id, fcmToken);
    return { success: true };
  }

  @Delete('me')
  @HttpCode(204)
  @ApiOperation({ summary: '회원 탈퇴 (계정 + 관련 데이터 cascade 삭제)' })
  remove(@CurrentUser() user: UserEntity) {
    return this.usersService.remove(user.id);
  }
}
