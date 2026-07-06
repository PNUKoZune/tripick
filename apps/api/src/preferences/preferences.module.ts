import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PreferenceEntity } from './preference.entity';
import { PreferenceEmbeddingRepository } from './preference-embedding.repository';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';
import { EmbeddingModule } from '../embedding/embedding.module';

@Module({
  imports: [TypeOrmModule.forFeature([PreferenceEntity]), EmbeddingModule],
  controllers: [PreferencesController],
  providers: [PreferencesService, PreferenceEmbeddingRepository],
  exports: [PreferencesService],
})
export class PreferencesModule {}
