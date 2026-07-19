import {
  Controller,
  Get,
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
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import {
  MAX_PREFERENCE_PHOTOS,
  MAX_PREFERENCE_UPLOAD,
  type PreferenceAnalysisJobDto,
} from '@tripick/types';
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

function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

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
  @ApiOperation({
    summary: `취향 이미지 업로드 → 분석 잡 등록 (한 번에 ${MAX_PREFERENCE_UPLOAD}장, 총 ${MAX_PREFERENCE_PHOTOS}장)`,
  })
  @ApiConsumes('multipart/form-data')
  // 인터셉터 한도는 총 보관 수로 두고 1회 업로드 한도는 핸들러에서 본다.
  // multer 한도에 걸리면 "Unexpected field - images" 라는 원인을 알 수 없는 메시지가 나가서다.
  @UseInterceptors(FilesInterceptor('images', MAX_PREFERENCE_PHOTOS))
  async uploadImages(
    @CurrentUser() user: UserEntity,
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)/ }),
        ],
      }),
    )
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
    const nextUrls = [...currentUrls, ...photoUrls];
    await this.preferencesService.upsert(user.id, { tasteTags: {}, photoUrls: nextUrls });

    return this.analysisService.enqueue(
      { userId: user.id, photoUrls, storageKeys },
      nextUrls,
    );
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
    const nextPhotoTags = Object.fromEntries(
      Object.entries(preference?.photoTags ?? {}).filter(([photoUrl]) =>
        nextUrls.includes(photoUrl),
      ),
    );
    const tasteTags = this.visionAnalyzer.aggregate(Object.values(nextPhotoTags));
    const updated = await this.preferencesService.upsert(user.id, {
      tasteTags,
      photoUrls: nextUrls,
      photoTags: nextPhotoTags,
    });

    return { photoUrls: updated.photoUrls, tasteTags: updated.tasteTags };
  }
}
