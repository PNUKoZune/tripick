import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { PreferencePhotoRefDto } from '@tripick/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { StorageService } from '../storage/storage.service';
import { PreferencesService } from './preferences.service';
import { PreferenceEntity } from './preference.entity';
import { UpdatePreferenceBodyDto } from './dto/preference.dto';

@ApiTags('Preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('preferences')
export class PreferencesController {
  constructor(
    private readonly preferencesService: PreferencesService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: '내 취향 설정 조회' })
  async getMyPreferences(@CurrentUser() user: UserEntity) {
    return this.withSignedPhotos(await this.preferencesService.findByUser(user.id));
  }

  @Put()
  @ApiOperation({ summary: '취향 설정 저장/갱신' })
  async upsertPreferences(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdatePreferenceBodyDto,
  ) {
    return this.withSignedPhotos(await this.preferencesService.upsert(user.id, dto));
  }

  /**
   * 엔티티를 그대로 내보내면 `photoKeys`(스토리지 키)만 나가서 화면이 이미지를 못 그린다 —
   * 비공개 버킷이라 키로는 읽을 수 없다. 표시용 **서명 URL** 을 여기서 붙인다.
   *
   * 키는 응답에 남긴다(`photos[].key`) — 삭제·태그 토글이 그걸로 사진을 지목하고,
   * URL 은 15분 뒤 만료되므로 식별자로 쓸 수 없다.
   */
  private async withSignedPhotos(
    preference: PreferenceEntity | null,
  ): Promise<(PreferenceEntity & { photos: PreferencePhotoRefDto[] }) | null> {
    if (!preference) return null;
    const keys = preference.photoKeys ?? [];
    const urls = keys.length > 0 ? await this.storage.signedUrls(keys) : [];
    return Object.assign(preference, {
      photos: keys.map((key, index) => ({ key, url: urls[index] ?? '' })),
    });
  }
}
