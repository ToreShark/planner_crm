// ============================================================
// Database Entities — PostgreSQL (TypeORM)
// Хранение планов, задач, метрик
// ============================================================

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { PlanType, TaskCategory, TaskPriority, TaskStatus } from './types';

// --- План (день/неделя/месяц) ---

@Entity('plans')
export class PlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: PlanType })
  @Index()
  type: PlanType;

  @Column({ type: 'date' })
  @Index()
  date: string;

  @Column({ name: 'date_end', type: 'date', nullable: true })
  dateEnd?: string;

  @Column({ name: 'focus_title', type: 'text' })
  focusTitle: string;

  @Column({ type: 'jsonb', nullable: true })
  intentions?: {
    main: string;
    secondary?: string;
    recovery?: string;
  };

  @Column({ name: 'strategic_intentions', type: 'jsonb', nullable: true })
  strategicIntentions?: string[];

  @Column({ type: 'jsonb', nullable: true })
  checkpoints?: Record<string, string>;

  @Column({ type: 'jsonb', nullable: true })
  risks?: Array<{ risk: string; mitigation: string }>;

  @Column({ name: 'raw_claude_response', type: 'jsonb', nullable: true })
  rawClaudeResponse?: Record<string, unknown>;

  @Column({ name: 'energy_level', type: 'smallint', nullable: true })
  energyLevel?: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  place?: string;

  @Column({ type: 'jsonb', nullable: true })
  results?: {
    wins?: string[];
    mistakes?: string[];
    lessons?: string[];
    nextPriorities?: string[];
  };

  @Column({ type: 'text', nullable: true })
  comment?: string;

  @Column({ type: 'jsonb', nullable: true })
  metrics?: {
    focusHours?: number;
    trainings?: number;
    clientCases?: number;
    contentPosts?: number;
    mood?: number;
  };

  @OneToMany(() => TaskEntity, (task) => task.plan, { cascade: true })
  tasks: TaskEntity[];

  @OneToMany(() => TimeBlockEntity, (block) => block.plan, { cascade: true })
  timeBlocks: TimeBlockEntity[];

  @OneToMany(() => PaymentEntity, (payment) => payment.plan, { cascade: true })
  payments: PaymentEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// --- Задача ---

@Entity('tasks')
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PlanEntity, (plan) => plan.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan: PlanEntity;

  @Column({ name: 'plan_id', type: 'uuid' })
  @Index()
  planId: string;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'enum', enum: TaskCategory })
  category: TaskCategory;

  @Column({ type: 'enum', enum: TaskPriority })
  priority: TaskPriority;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.PENDING })
  status: TaskStatus;

  @Column({ name: 'estimated_minutes', type: 'smallint', nullable: true })
  estimatedMinutes?: number;

  @Column({ name: 'suggested_time', type: 'varchar', length: 20, nullable: true })
  suggestedTime?: string;

  @Column({ name: 'linked_case_id', type: 'varchar', length: 100, nullable: true })
  linkedCaseId?: string;

  @Column({ name: 'is_recurring', type: 'boolean', default: false })
  isRecurring: boolean;

  @Column({ name: 'sort_order', type: 'smallint', default: 0 })
  sortOrder: number;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt?: Date;

  @Column({ name: 'deferred_reason', type: 'text', nullable: true })
  deferredReason?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// --- Временной блок ---

@Entity('time_blocks')
export class TimeBlockEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PlanEntity, (plan) => plan.timeBlocks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan: PlanEntity;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ name: 'start_time', type: 'varchar', length: 10 })
  startTime: string;

  @Column({ name: 'end_time', type: 'varchar', length: 10 })
  endTime: string;

  @Column({ type: 'varchar', length: 200 })
  label: string;

  @Column({ type: 'enum', enum: TaskCategory })
  category: TaskCategory;

  @Column({ name: 'task_ids', type: 'jsonb', default: [] })
  taskIds: string[];
}

// --- Оплаты ---

@Entity('plan_payments')
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PlanEntity, (plan) => plan.payments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan: PlanEntity;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ name: 'client_name', type: 'varchar', length: 200 })
  clientName: string;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'varchar', length: 10, default: 'KZT' })
  currency: string;

  @Column({ type: 'boolean', default: false })
  received: boolean;
}
