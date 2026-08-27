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
    if (!this.storage.isReady()) {
      throw new ServiceUnavailableException(
        '이미지 저장소가 설정되지 않아 사진 분석을 시작할 수 없습니다.',
      );
    }

    const existing = await this.preferencesService.findByUser(user.id);
    const currentUrls = existing?.photoUrls ?? [];
    if (currentUrls.length + files.length > MAX_PREFERENCE_PHOTOS) {
      throw new BadRequestException(
        `취향 사진은 최대 ${MAX_PREFERENCE_PHOTOS}장까지 보관할 수 있습니다. (현재 ${currentUrls.length}장)`,
      );
    }

    const stamp = Date.now();
    const storageKeys = files.map(
      (file, index) =>
        `public/preferences/${user.id}/${stamp}-${index}.${extForMime(file.mimetype)}`,
    );
    const photoUrls = await Promise.all(
      files.map((file, index) =>
        this.storage.putObject({
          key: storageKeys[index] as string,
          body: file.buffer,
          contentType: file.mimetype,
        }),
      ),
    );

    // 사진은 먼저 붙여 둔다 — 분석 전이라도 사용자가 올린 사진은 화면에 보여야 한다.
    // 태그는 아직 안 바뀌었으므로 재임베딩이 없는 setPhotoUrls 로 저장한다.
    const nextUrls = [...currentUrls, ...photoUrls];
    await this.preferencesService.setPhotoUrls(user.id, nextUrls);

    // 이전 잡이 재시도까지 실패해 아직 분석되지 않은 사진이 있으면 이번 잡에 같이 태운다.
    // 그러지 않으면 그 사진은 삭제 전까지 영영 무신호로 남는다.
    const stranded = this.pendingPhotos(currentUrls, existing?.photoTags ?? {});

    return this.analysisService.enqueue(
      {
        userId: user.id,
        photoUrls: [...stranded.urls, ...photoUrls],
        storageKeys: [...stranded.keys, ...storageKeys],
      },
      nextUrls,
    );
  }

  @Post('reanalyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(VISION_UPLOAD_LIMIT)
  @ApiOperation({
    summary: '보관 중인 사진 중 아직 분석되지 않은 것만 다시 분석 (새 업로드 없이)',
  })
  async reanalyze(@CurrentUser() user: UserEntity): Promise<PreferenceAnalysisJobDto> {
    // 잡이 원본을 스토리지에서 다시 읽는다 (업로드와 같은 이유로 스토리지가 필수).
    if (!this.storage.isReady()) {
      throw new ServiceUnavailableException(
        '이미지 저장소가 설정되지 않아 사진 분석을 시작할 수 없습니다.',
      );
    }

    const existing = await this.preferencesService.findByUser(user.id);
    const photoUrls = existing?.photoUrls ?? [];
    const pending = this.pendingPhotos(photoUrls, existing?.photoTags ?? {});
    if (pending.urls.length === 0) {
      throw new BadRequestException('다시 분석할 사진이 없습니다.');
    }

    // 이미 돌고 있는 잡이 있으면 그 잡을 돌려준다 — 새로 등록하면 같은 사진을 두 번 분석한다.
    // (분석 중인 사진도 아직 결과가 없어 pending 으로 잡히므로 이 검사가 반드시 필요하다)
    const running = await this.analysisService.findActiveJob(user.id);
    if (running) return running;

    return this.analysisService.enqueue(
      { userId: user.id, photoUrls: pending.urls, storageKeys: pending.keys },
      photoUrls,
    );
  }

  /** 분석 결과가 없는 기존 사진과 그 스토리지 키. 키를 못 구하는 외부 URL 은 건너뛴다. */
  private pendingPhotos(
    urls: string[],
    photoTags: Record<string, unknown>,
  ): { urls: string[]; keys: string[] } {
    const pendingUrls: string[] = [];
    const pendingKeys: string[] = [];
    for (const url of urls) {
      if (photoTags[url]) continue;
      const key = this.storage.keyFromPublicUrl(url);
      if (!key) continue;
      pendingUrls.push(url);
      pendingKeys.push(key);
    }
    return { urls: pendingUrls, keys: pendingKeys };
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
  @ApiOperation({ summary: '취향 사진 개별 삭제 (스토리지 원본 + URL 제거 + 태그 재집계)' })
  async deletePhoto(@CurrentUser() user: UserEntity, @Query('url') url?: string) {
    if (!url) {
      throw new BadRequestException('삭제할 사진 URL이 필요합니다.');
    }
    const preference = await this.preferencesService.findByUser(user.id);
    const current = preference?.photoUrls ?? [];
    // 본인 취향 사진 목록에 있는 URL 만 삭제 (임의 오브젝트 삭제 방지)
    if (!current.includes(url)) {
      return { photoUrls: current, tasteTags: preference?.tasteTags };
    }
    const key = this.storage.keyFromPublicUrl(url);
    if (key) await this.storage.deleteObject(key);

    // 남은 사진의 분석 결과만으로 취향 태그를 다시 만든다 — 지운 사진의 취향이 남지 않도록.
    const nextUrls = current.filter((item) => item !== url);
    const state = {
      photoUrls: nextUrls,
      photoTags: pruneToPhotos(preference?.photoTags ?? {}, nextUrls),
      disabledPhotoTags: pruneToPhotos(preference?.disabledPhotoTags ?? {}, nextUrls),
    };
    const updated = await this.preferencesService.upsert(user.id, {
      tasteTags: this.visionAnalyzer.aggregate(effectivePhotoTags(state)),
      photoUrls: nextUrls,
      photoTags: state.photoTags,
      disabledPhotoTags: state.disabledPhotoTags,
    });

    return {
      photoUrls: updated.photoUrls,
      tasteTags: updated.tasteTags,
      photos: buildPhotoTagsView(state),
    };
  }

  @Get('photos/tags')
  @ApiOperation({ summary: '사진별 추출 태그와 on/off 상태 조회' })
  async listPhotoTags(@CurrentUser() user: UserEntity): Promise<PreferencePhotoTagsDto[]> {
    const preference = await this.preferencesService.findByUser(user.id);
    return buildPhotoTagsView({
      photoUrls: preference?.photoUrls ?? [],
      photoTags: preference?.photoTags ?? {},
      disabledPhotoTags: preference?.disabledPhotoTags ?? {},
    });
  }

  @Patch('photos/tags')
  @ApiOperation({ summary: '특정 사진에서 추출된 특정 태그를 켜거나 끈다 (재집계 포함)' })
  async togglePhotoTag(@CurrentUser() user: UserEntity, @Body() dto: TogglePhotoTagBodyDto) {
    const preference = await this.preferencesService.findByUser(user.id);
    const photoUrls = preference?.photoUrls ?? [];
    // 본인 사진이 아니거나, 그 사진에서 나오지 않은 태그는 건드릴 수 없다.
    if (!photoUrls.includes(dto.url)) {
      throw new NotFoundException('해당 취향 사진을 찾을 수 없습니다.');
    }
    const analyzed = preference?.photoTags?.[dto.url];
    if (!analyzed || !tagsOf(analyzed).includes(dto.tag)) {
      throw new BadRequestException('이 사진에서 추출된 태그가 아닙니다.');
    }

    const state = {
      photoUrls,
      photoTags: preference?.photoTags ?? {},
      disabledPhotoTags: toggleDisabledTag(
        preference?.disabledPhotoTags ?? {},
        dto.url,
        dto.tag,
        dto.enabled,
      ),
    };
    const updated = await this.preferencesService.upsert(user.id, {
      tasteTags: this.visionAnalyzer.aggregate(effectivePhotoTags(state)),
      disabledPhotoTags: state.disabledPhotoTags,
    });

    return { tasteTags: updated.tasteTags, photos: buildPhotoTagsView(state) };
  }
}
