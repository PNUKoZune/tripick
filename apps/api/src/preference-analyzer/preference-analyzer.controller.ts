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
    private readonly preferencesService: PreferencesService,
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
    const imageUrls = files.map((file) => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`);
    const tasteTags = await this.visionAnalyzer.analyzeMultiple(imageUrls);
    // upsert 내부에서 취향 임베딩(preference_embeddings) 저장까지 처리
    const preference = await this.preferencesService.upsert(user.id, { tasteTags });

    return { tasteTags, embeddingId: preference.embeddingId ?? '', preferenceId: preference.id };
  }
}
