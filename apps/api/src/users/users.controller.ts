import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FcmTokenService } from '../notification/fcm-token.service';
import { UsersService } from './users.service';
import { UserEntity } from './user.entity';
import { WithdrawUserDto } from './dto/withdraw-user.dto';
import { UpdateNotificationPreferencesBodyDto } from './dto/update-notification-preferences.dto';
import { UpdateUserBodyDto } from './dto/update-user.dto';
import { RemoveFcmTokenQueryDto, UpdateFcmTokenBodyDto } from './dto/fcm-token.dto';

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly fcmTokens: FcmTokenService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: '내 프로필 조회' })
  getMe(@CurrentUser() user: UserEntity) {
    return this.usersService.publicProfile(user);
  }

  @Patch('me')
  @ApiOperation({ summary: '내 프로필 수정' })
  async updateMe(@CurrentUser() user: UserEntity, @Body() dto: UpdateUserBodyDto) {
    return this.usersService.publicProfile(await this.usersService.update(user.id, dto));
  }

  @Patch('me/notification-preferences')
  @ApiOperation({ summary: '알림 수신 설정 갱신' })
  updateNotificationPreferences(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateNotificationPreferencesBodyDto,
  ) {
    return this.usersService.updateNotificationPreferences(user.id, dto.preferences);
  }

  @Patch('me/fcm-token')
  @ApiOperation({ summary: 'FCM 토큰 등록/갱신 (기기별 다건 지원)' })
  async updateFcmToken(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateFcmTokenBodyDto,
  ) {
    await this.fcmTokens.register(user.id, dto.fcmToken, dto.platform);
    return { success: true };
  }

  @Delete('me/fcm-token')
  @ApiOperation({ summary: 'FCM 토큰 해제 (로그아웃/기기 정리)' })
  async removeFcmToken(
    @CurrentUser() user: UserEntity,
    @Query() query: RemoveFcmTokenQueryDto,
  ) {
    await this.fcmTokens.removeForUser(user.id, query.fcmToken);
    return { success: true };
  }

  @Post('me/profile-image')
  @ApiOperation({ summary: '프로필 이미지 업로드' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadProfileImage(
    @CurrentUser() user: UserEntity,
    @UploadedFile() file?: UploadedImage,
  ) {
    if (!file) throw new BadRequestException('파일이 필요합니다.');
    return this.usersService.publicProfile(
      await this.usersService.uploadProfileImage(user.id, file),
    );
  }

  @Delete('me/profile-image')
  @ApiOperation({ summary: '프로필 이미지 초기화 (기본 아바타로 복구)' })
  async removeProfileImage(@CurrentUser() user: UserEntity) {
    return this.usersService.publicProfile(await this.usersService.removeProfileImage(user.id));
  }

  @Post('me/withdrawal')
  @HttpCode(204)
  @ApiOperation({
    summary: '회원 탈퇴 (사유 수집 + 확인 문구 검증 후 계정·관련 데이터 즉시 삭제)',
  })
  withdraw(@CurrentUser() user: UserEntity, @Body() dto: WithdrawUserDto) {
    return this.usersService.withdraw(user.id, dto);
  }
}
