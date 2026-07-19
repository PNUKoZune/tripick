import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PreferenceAnalyzerController } from './preference-analyzer.controller';
import { PreferenceAnalyzerProcessor } from './preference-analyzer.processor';
import { PreferenceAnalysisService } from './preference-analysis.service';
import { VisionAnalyzer } from './vision.analyzer';
import { PREFERENCE_ANALYSIS_QUEUE } from './preference-analyzer.constants';
import { PreferencesModule } from '../preferences/preferences.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: PREFERENCE_ANALYSIS_QUEUE }),
    PreferencesModule,
    StorageModule,
    NotificationModule,
  ],
  controllers: [PreferenceAnalyzerController],
  providers: [VisionAnalyzer, PreferenceAnalysisService, PreferenceAnalyzerProcessor],
})
export class PreferenceAnalyzerModule {}
