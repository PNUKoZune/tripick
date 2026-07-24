import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import type { WithdrawalReasonCode } from '@tripick/types';

/**
 * 탈퇴 사유 로그. 계정은 hard delete 라 userId FK 를 두지 않고 익명 집계 row 만 남긴다
 * (사유를 남길 사람을 다시 식별할 수 있으면 삭제 요청의 취지에 어긋남).
 * 사유 선택은 선택사항이라 reason·detail 모두 null 일 수 있다(= 건너뛰고 탈퇴).
 */
@Entity('withdrawal_reasons')
export class WithdrawalReasonEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** WITHDRAWAL_REASONS 의 code. 건너뛰면 null */
  @Column({ type: 'varchar', nullable: true })
  reason?: WithdrawalReasonCode | null;

  /** 자유 입력(최대 500자). 없으면 null */
  @Column({ type: 'text', nullable: true })
  detail?: string | null;

  /** 가입 후 며칠 만에 떠났는지 — 사유 해석에 쓰는 유일한 부가 정보 */
  @Column({ type: 'int' })
  accountAgeDays: number;

  @CreateDateColumn()
  createdAt: Date;
}
