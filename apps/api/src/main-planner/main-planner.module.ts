import { Module } from '@nestjs/common';
import { MainPlannerController } from './main-planner.controller';

@Module({
  controllers: [MainPlannerController],
})
export class MainPlannerModule {}
