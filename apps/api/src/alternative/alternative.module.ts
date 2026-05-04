import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AlternativeController } from './alternative.controller';
import { AlternativeProcessor } from './alternative.processor';
import { AlternativeGateway } from './alternative.gateway';
import { REPLAN_QUEUE } from '../replanning/replanning.constants';
import { PlannerModule } from '../planner/planner.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: REPLAN_QUEUE }),
    PlannerModule,
    RealtimeModule,
  ],
  controllers: [AlternativeController],
  providers: [AlternativeProcessor, AlternativeGateway],
})
export class AlternativeModule {}
