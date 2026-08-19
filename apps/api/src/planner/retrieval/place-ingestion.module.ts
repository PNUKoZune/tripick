import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngestCursorRepository } from './ingest-cursor.repository';
import { KakaoLocalService } from './kakao-local.service';
import { NaverSearchService } from './naver-search.service';
import { PlaceEmbeddingRepository } from './place-embedding.repository';
import { PlaceIngestionService } from './place-ingestion.service';
import { KeywordPlaceService } from './keyword-place.service';
import { PopularPlaceService } from './popular-place.service';
import { TextEmbeddingService } from '../../embedding/text-embedding.service';
import { TourApiService } from './tour-api.service';

/**
 * 적재 CLI(ingest-places.ts) 전용 경량 모듈.
 * AppModule 전체(BullMQ/Redis/Throttler/WebSocket)를 띄우지 않고
 * ConfigModule + TypeORM DataSource 만으로 적재 서비스를 구동한다.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url:
          config.get<string>('DATABASE_URL') ??
          'postgresql://tripick:tripick@localhost:5432/tripick',
        autoLoadEntities: true,
        synchronize: false,
        logging: false,
      }),
    }),
  ],
  providers: [
    TourApiService,
    KakaoLocalService,
    NaverSearchService,
    KeywordPlaceService,
    PopularPlaceService,
    TextEmbeddingService,
    PlaceEmbeddingRepository,
    IngestCursorRepository,
    PlaceIngestionService,
  ],
})
export class PlaceIngestionModule {}
