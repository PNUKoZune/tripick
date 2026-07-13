import { Module } from '@nestjs/common';
import { PreferenceAnalyzerController } from './preference-analyzer.controller';
import { VisionAnalyzer } from './vision.analyzer';
import { PreferencesModule } from '../preferences/preferences.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PreferencesModule, StorageModule],
  controllers: [PreferenceAnalyzerController],
  providers: [VisionAnalyzer],
})
export class PreferenceAnalyzerModule {}
