import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InferenceModelExecutionEntity } from './inference-model-execution.entity';
import { InferenceResourceEntity } from './inference-resource.entity';
import { InferenceResourceService } from './inference-resource.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([InferenceResourceEntity, InferenceModelExecutionEntity])],
  providers: [InferenceResourceService],
  exports: [InferenceResourceService],
})
export class InferenceResourceModule {}
