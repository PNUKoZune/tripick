import { Module } from '@nestjs/common';
import { PreferenceAnalyzerController } from './preference-analyzer.controller';
import { VisionAnalyzer } from './vision.analyzer';
import { PreferencesModule } from '../preferences/preferences.module';

@Module({
  imports: [PreferencesModule],
  controllers: [PreferenceAnalyzerController],
  providers: [VisionAnalyzer],
})
export class PreferenceAnalyzerModule {}
