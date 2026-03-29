// ============================================================
// Planner Module
// ============================================================

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PlannerController } from './planner.controller';
import { ClaudePlannerService } from './claude-planner.service';
import { ContextBuilderService } from './context-builder.service';
import { PlanStoreService } from './plan-store.service';
import { PlanEntity, TaskEntity, TimeBlockEntity, PaymentEntity } from './entities';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([PlanEntity, TaskEntity, TimeBlockEntity, PaymentEntity]),
  ],
  controllers: [PlannerController],
  providers: [ClaudePlannerService, ContextBuilderService, PlanStoreService],
  exports: [ClaudePlannerService, ContextBuilderService, PlanStoreService],
})
export class PlannerModule {}
