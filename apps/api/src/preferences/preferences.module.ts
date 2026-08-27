import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PreferenceEntity } from './preference.entity';
import { PreferenceEmbeddingRepository } from './preference-embedding.repository';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';
import { EmbeddingModule } from '../embedding/embedding.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  // StorageModule — 컨트롤러가 취향 사진의 표시용 서명 URL 을 만든다(비공개 버킷).
  imports: [TypeOrmModule.forFeature([PreferenceEntity]), EmbeddingModule, StorageModule],
  controllers: [PreferencesController],
  providers: [PreferencesService, PreferenceEmbeddingRepository],
  exports: [PreferencesService],
})
export class PreferencesModule {}
