import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReplanningController } from './replanning.controller';
import { ReplanningService } from './replanning.service';
import { REPLAN_QUEUE } from './replanning.constants';

@Module({
  imports: [BullModule.registerQueue({ name: REPLAN_QUEUE })],
  controllers: [ReplanningController],
  providers: [ReplanningService],
  exports: [ReplanningService],
})
export class ReplanningModule {}
