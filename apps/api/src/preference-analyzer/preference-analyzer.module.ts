import { Module } from '@nestjs/common';
import { PreferenceAnalyzerController } from './preference-analyzer.controller';
import { VisionAnalyzer } from './vision.analyzer';
import { EmbeddingService } from './embedding.service';
import { PreferencesModule } from '../preferences/preferences.module';

@Module({
  imports: [PreferencesModule],
  controllers: [PreferenceAnalyzerController],
  providers: [VisionAnalyzer, EmbeddingService],
})
export class PreferenceAnalyzerModule {}
