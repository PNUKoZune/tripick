import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { VisionAnalyzer } from './vision.analyzer';
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
    private readonly preferencesService: PreferencesService,
    private readonly storage: StorageService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: '취향 이미지 업로드 → 분석 → 임베딩 저장 (온보딩)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('images', 10))
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
  ) {
    // 분석은 오프라인에서도 되도록 base64 data URL 로 수행한다.
    const dataUrls = files.map(
      (file) => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
    );
    const tasteTags = await this.visionAnalyzer.analyzeMultiple(dataUrls);

    // 스토리지가 설정된 경우에만 원본을 Object Storage 에 보관하고 URL 을 남긴다.
    let photoUrls: string[] | undefined;
    let oldPhotoUrls: string[] = [];
    if (this.storage.isReady()) {
      const existing = await this.preferencesService.findByUser(user.id);
      oldPhotoUrls = existing?.photoUrls ?? [];
      const stamp = Date.now();
      photoUrls = await Promise.all(
        files.map((file, index) =>
          this.storage.putObject({
            key: `public/preferences/${user.id}/${stamp}-${index}.${extForMime(file.mimetype)}`,
            body: file.buffer,
            contentType: file.mimetype,
          }),
        ),
      );
    }

    // upsert 내부에서 취향 임베딩(preference_embeddings) 저장까지 처리. photoUrls 지정 시 교체.
    const preference = await this.preferencesService.upsert(user.id, {
      tasteTags,
      ...(photoUrls ? { photoUrls } : {}),
    });

    // 새 사진으로 교체됐으면 이전 원본은 정리
    if (photoUrls) {
      for (const url of oldPhotoUrls) {
        const key = this.storage.keyFromPublicUrl(url);
        if (key) void this.storage.deleteObject(key);
      }
    }

    return {
      tasteTags,
      photoUrls: preference.photoUrls ?? [],
      embeddingId: preference.embeddingId ?? '',
      preferenceId: preference.id,
    };
  }
}
