import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PreferenceEmbeddingRepository } from './preference-embedding.repository';
import { PreferenceReembedService } from './preference-reembed.service';
import { EmbeddingModule } from '../embedding/embedding.module';

/**
 * 취향 재임베딩 CLI(reembed-preferences.ts) 전용 경량 모듈.
 * AppModule 전체를 띄우지 않고 ConfigModule + TypeORM DataSource 만으로 구동한다.
 * 취향 읽기/쓰기는 raw dataSource.query 로 처리하므로 엔티티 등록이 필요 없다.
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
    EmbeddingModule,
  ],
  providers: [PreferenceEmbeddingRepository, PreferenceReembedService],
})
export class PreferenceReembedModule {}
