import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseFilePipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import {
  MAX_PREFERENCE_PHOTOS,
  MAX_PREFERENCE_UPLOAD,
  type PreferenceAnalysisJobDto,
  type PreferencePhotoTagsDto,
} from '@tripick/types';
import {
  buildPhotoTagsView,
  effectivePhotoTags,
  pruneToPhotos,
  tagsOf,
  toggleDisabledTag,
} from '../preferences/photo-taste';
import { TogglePhotoTagBodyDto } from '../preferences/dto/preference.dto';
import { VISION_UPLOAD_LIMIT } from '../common/throttle';
import { ImageFileValidator, extForMime } from '../common/image-upload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { VisionAnalyzer } from './vision.analyzer';
import { PreferenceAnalysisService } from './preference-analysis.service';
import { PreferencesService } from '../preferences/preferences.service';
import { StorageService } from '../storage/storage.service';

type UploadedImageFile = {
  mimetype: string;
  buffer: Buffer;
};

@ApiTags('PreferenceAnalyzer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('preference-analyzer')
export class PreferenceAnalyzerController {
  constructor(
    private readonly visionAnalyzer: VisionAnalyzer,
    private readonly analysisService: PreferenceAnalysisService,
    private readonly preferencesService: PreferencesService,
    private readonly storage: StorageService,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  // 1회 업로드가 사진 3장(각 10MB) + vision 추론 3건이다. 전역 120/분으로는 못 막는다.
  @Throttle(VISION_UPLOAD_LIMIT)
  @ApiOperation({
    summary: `취향 이미지 업로드 → 분석 잡 등록 (한 번에 ${MAX_PREFERENCE_UPLOAD}장, 총 ${MAX_PREFERENCE_PHOTOS}장)`,
  })
  @ApiConsumes('multipart/form-data')
  // 인터셉터 한도는 총 보관 수로 두고 1회 업로드 한도는 핸들러에서 본다.
  // multer 한도에 걸리면 "Unexpected field - images" 라는 원인을 알 수 없는 메시지가 나가서다.
  @UseInterceptors(FilesInterceptor('images', MAX_PREFERENCE_PHOTOS))
  async uploadImages(
    @CurrentUser() user: UserEntity,
    // 크기·mimetype·매직바이트를 한 검증기에서 본다. 예전엔 앵커 없는 정규식이라
    // `ximage/png` 같은 값도 통과했고, 실제 바이트가 이미지인지는 아무도 확인하지 않았다.
    @UploadedFiles(new ParseFilePipe({ validators: [new ImageFileValidator()] }))
    files: UploadedImageFile[],
  ): Promise<PreferenceAnalysisJobDto> {
    if (files.length === 0) {
      throw new BadRequestException('분석할 사진이 없습니다.');
    }
    if (files.length > MAX_PREFERENCE_UPLOAD) {
      throw new BadRequestException(
        `사진은 한 번에 ${MAX_PREFERENCE_UPLOAD}장까지 올릴 수 있습니다.`,
      );
    }
    // 비동기 분석은 잡이 원본을 다시 읽어야 해서 스토리지가 필수다.
    // (Redis 잡에 이미지 바이트를 싣지 않는다)
    // 취향 사진은 **비공개 버킷**에만 올린다. 공개 버킷 폴백을 두면 개인 사진이 CDN
    // 도메인에서 그대로 열려, 이 구조로 막으려는 노출이 그대로 남는다.
    if (!this.storage.isPrivateReady()) {
      throw new ServiceUnavailableException(
        '이미지 저장소가 설정되지 않아 사진 분석을 시작할 수 없습니다.',
      );
    }

    const existing = await this.preferencesService.findByUser(user.id);
    const currentKeys = existing?.photoKeys ?? [];
    if (currentKeys.length + files.length > MAX_PREFERENCE_PHOTOS) {
      throw new BadRequestException(
        `취향 사진은 최대 ${MAX_PREFERENCE_PHOTOS}장까지 보관할 수 있습니다. (현재 ${currentKeys.length}장)`,
      );
    }

    // `public/` 프리픽스를 떼었다 — 공개 여부는 이제 버킷이 가른다.
    const stamp = Date.now();
    const newKeys = files.map(
      (file, index) => `preferences/${user.id}/${stamp}-${index}.${extForMime(file.mimetype)}`,
    );
    await Promise.all(
      files.map((file, index) =>
        this.storage.putPrivateObject({
          key: newKeys[index] as string,
          body: file.buffer,
          contentType: file.mimetype,
        }),
      ),
    );

    // 사진은 먼저 붙여 둔다 — 분석 전이라도 사용자가 올린 사진은 화면에 보여야 한다.
    // 태그는 아직 안 바뀌었으므로 재임베딩이 없는 setPhotoKeys 로 저장한다.
    const nextKeys = [...currentKeys, ...newKeys];
    await this.preferencesService.setPhotoKeys(user.id, nextKeys);

    // 이전 잡이 재시도까지 실패해 아직 분석되지 않은 사진이 있으면 이번 잡에 같이 태운다.
    // 그러지 않으면 그 사진은 삭제 전까지 영영 무신호로 남는다.
    const stranded = this.pendingPhotoKeys(currentKeys, existing?.photoTags ?? {});

    return this.analysisService.enqueue(
      { userId: user.id, photoKeys: [...stranded, ...newKeys] },
      nextKeys,
    );
  }

  @Post('reanalyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(VISION_UPLOAD_LIMIT)
  @ApiOperation({
    summary: '보관 중인 사진 중 아직 분석되지 않은 것만 다시 분석 (새 업로드 없이)',
  })
  async reanalyze(@CurrentUser() user: UserEntity): Promise<PreferenceAnalysisJobDto> {
    // 잡이 원본을 **비공개 버킷**에서 다시 읽는다 (업로드와 같은 이유로 필수).
    if (!this.storage.isPrivateReady()) {
      throw new ServiceUnavailableException(
        '이미지 저장소가 설정되지 않아 사진 분석을 시작할 수 없습니다.',
      );
    }

    const existing = await this.preferencesService.findByUser(user.id);
    const photoKeys = existing?.photoKeys ?? [];
    const pending = this.pendingPhotoKeys(photoKeys, existing?.photoTags ?? {});
    if (pending.length === 0) {
      throw new BadRequestException('다시 분석할 사진이 없습니다.');
    }

    // 이미 돌고 있는 잡이 있으면 그 잡을 돌려준다 — 새로 등록하면 같은 사진을 두 번 분석한다.
    // (분석 중인 사진도 아직 결과가 없어 pending 으로 잡히므로 이 검사가 반드시 필요하다)
    const running = await this.analysisService.findActiveJob(user.id);
    if (running) return running;

    return this.analysisService.enqueue(
      { userId: user.id, photoKeys: pending },
      photoKeys,
    );
  }

  /**
   * 분석 결과가 아직 없는 사진의 키.
   *
   * 예전에는 공개 URL 에서 키를 되뽑아야 했지만(`keyFromPublicUrl`), 이제 저장된 값이
   * 곧 키라 변환이 필요 없다 — 외부 URL 이 섞일 여지도 없어졌다.
   */
  private pendingPhotoKeys(keys: string[], photoTags: Record<string, unknown>): string[] {
    return keys.filter((key) => key && !photoTags[key]);
  }

  /** 표시용 서명 URL. 만료되므로 응답을 만들 때마다 새로 만든다(DB 에 저장하지 않는다). */
  private async signedUrlByKey(keys: string[]): Promise<Map<string, string>> {
    const urls = await this.storage.signedUrls(keys);
    return new Map(keys.map((key, index) => [key, urls[index] ?? '']));
  }


  @Get('jobs/:jobId')
  @ApiOperation({ summary: '취향 사진 분석 잡 상태 조회' })
  async getJob(
    @CurrentUser() user: UserEntity,
    @Param('jobId') jobId: string,
  ): Promise<PreferenceAnalysisJobDto> {
    const status = await this.analysisService.getStatus(jobId, user.id);
    if (!status) {
      throw new NotFoundException('분석 잡을 찾을 수 없습니다.');
    }
    return status;
  }

  @Delete('photos')
  @ApiOperation({ summary: '취향 사진 개별 삭제 (스토리지 원본 + 키 제거 + 태그 재집계)' })
  async deletePhoto(@CurrentUser() user: UserEntity, @Query('key') key?: string) {
    if (!key) {
      throw new BadRequestException('삭제할 사진이 지정되지 않았습니다.');
    }
    const preference = await this.preferencesService.findByUser(user.id);
    const current = preference?.photoKeys ?? [];
    // 본인 취향 사진 목록에 있는 키만 삭제 (임의 오브젝트 삭제 방지)
    if (!current.includes(key)) {
      return { photos: [], tasteTags: preference?.tasteTags };
    }
    await this.storage.deletePrivateObject(key);

    // 남은 사진의 분석 결과만으로 취향 태그를 다시 만든다 — 지운 사진의 취향이 남지 않도록.
    const nextKeys = current.filter((item) => item !== key);
    const state = {
      photoKeys: nextKeys,
      photoTags: pruneToPhotos(preference?.photoTags ?? {}, nextKeys),
      disabledPhotoTags: pruneToPhotos(preference?.disabledPhotoTags ?? {}, nextKeys),
    };
    const updated = await this.preferencesService.upsert(user.id, {
      tasteTags: this.visionAnalyzer.aggregate(effectivePhotoTags(state)),
      photoKeys: nextKeys,
      photoTags: state.photoTags,
      disabledPhotoTags: state.disabledPhotoTags,
    });

    // 사진 목록과 태그 뷰가 따로 나가던 것을 하나로 합쳤다 — 이제 `photos` 가 키·표시 URL·
    // 태그를 모두 들고 있어 클라이언트가 두 배열을 짝지을 필요가 없다.
    return {
      tasteTags: updated.tasteTags,
      photos: buildPhotoTagsView(state, await this.signedUrlByKey(state.photoKeys)),
    };
  }

  @Get('photos/tags')
  @ApiOperation({ summary: '사진별 추출 태그와 on/off 상태 조회' })
  async listPhotoTags(@CurrentUser() user: UserEntity): Promise<PreferencePhotoTagsDto[]> {
    const preference = await this.preferencesService.findByUser(user.id);
    const photoKeys = preference?.photoKeys ?? [];
    return buildPhotoTagsView(
      {
        photoKeys,
        photoTags: preference?.photoTags ?? {},
        disabledPhotoTags: preference?.disabledPhotoTags ?? {},
      },
      await this.signedUrlByKey(photoKeys),
    );
  }

  @Patch('photos/tags')
  @ApiOperation({ summary: '특정 사진에서 추출된 특정 태그를 켜거나 끈다 (재집계 포함)' })
  async togglePhotoTag(@CurrentUser() user: UserEntity, @Body() dto: TogglePhotoTagBodyDto) {
    const preference = await this.preferencesService.findByUser(user.id);
    const photoKeys = preference?.photoKeys ?? [];
    // 본인 사진이 아니거나, 그 사진에서 나오지 않은 태그는 건드릴 수 없다.
    if (!photoKeys.includes(dto.key)) {
      throw new NotFoundException('해당 취향 사진을 찾을 수 없습니다.');
    }
    const analyzed = preference?.photoTags?.[dto.key];
    if (!analyzed || !tagsOf(analyzed).includes(dto.tag)) {
      throw new BadRequestException('이 사진에서 추출된 태그가 아닙니다.');
    }

    const state = {
      photoKeys,
      photoTags: preference?.photoTags ?? {},
      disabledPhotoTags: toggleDisabledTag(
        preference?.disabledPhotoTags ?? {},
        dto.key,
        dto.tag,
        dto.enabled,
      ),
    };
    const updated = await this.preferencesService.upsert(user.id, {
      tasteTags: this.visionAnalyzer.aggregate(effectivePhotoTags(state)),
      disabledPhotoTags: state.disabledPhotoTags,
    });

    return {
      tasteTags: updated.tasteTags,
      photos: buildPhotoTagsView(state, await this.signedUrlByKey(photoKeys)),
    };
  }
}
