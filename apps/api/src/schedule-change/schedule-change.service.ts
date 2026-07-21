import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboxService } from '../inbox/inbox.service';
import { MainPlannerService } from '../main-planner/main-planner.service';
import { ReplanningService } from '../replanning/replanning.service';
import { TripsService } from '../trips/trips.service';
import { UserEntity } from '../users/user.entity';
import { ScheduleChangeProposalEntity } from './schedule-change.entity';
import type {
  CreateScheduleChangeDto,
  ScheduleChangeKind,
  ScheduleChangeListDto,
  ScheduleChangePayload,
  ScheduleChangeProposalDto,
} from '@tripick/types';

const KNOWN_KINDS: readonly ScheduleChangeKind[] = [
  'add_item',
  'update_item',
  'delete_item',
  'reorder_items',
  'swap',
  'replan',
];

@Injectable()
export class ScheduleChangeService {
  private readonly logger = new Logger(ScheduleChangeService.name);

  constructor(
    @InjectRepository(ScheduleChangeProposalEntity)
    private readonly repo: Repository<ScheduleChangeProposalEntity>,
    private readonly tripsService: TripsService,
    private readonly mainPlannerService: MainPlannerService,
    private readonly replanningService: ReplanningService,
    private readonly inboxService: InboxService,
  ) {}

  /**
   * 참여자(비-owner)가 일정 변경을 제안한다. 즉시 반영하지 않고 pending 으로 저장하고
   * owner 에게 승인 요청 알림(schedule_change_request)을 보낸다.
   */
  async propose(
    requester: UserEntity,
    dto: CreateScheduleChangeDto,
  ): Promise<ScheduleChangeProposalDto> {
    // owner 또는 accepted 멤버만 접근 가능. owner 는 직접 변경 엔드포인트를 쓰므로 제안 경로 차단.
    const trip = await this.tripsService.findOneForViewer(dto.tripId, requester.id);
    if (trip.userId === requester.id) {
      throw new BadRequestException('owner 는 변경을 바로 반영할 수 있어요.');
    }
    // DTO discriminator 가 못 거른 미지의 kind 를 여기서 400 으로 막는다
    // (없으면 locate 가 undefined 를 반환해 구조분해에서 500 크래시).
    if (!KNOWN_KINDS.includes(dto.payload?.kind)) {
      throw new BadRequestException('지원하지 않는 변경 유형이에요.');
    }

    const { day, targetItemId } = this.locate(dto.payload);
    const summary = await this.buildSummary(dto.tripId, dto.payload);

    const proposal = await this.repo.save(
      this.repo.create({
        tripId: dto.tripId,
        requesterId: requester.id,
        kind: dto.payload.kind,
        payload: dto.payload,
        summary,
        status: 'pending',
        day: day ?? null,
        targetItemId: targetItemId ?? null,
      }),
    );

    await this.inboxService.create({
      userId: trip.userId,
      category: 'schedule_change_request',
      title: `${requester.nickname}님의 일정 변경 요청`,
      body: summary,
      payload: {
        tripId: dto.tripId,
        proposalId: proposal.id,
        ...(day ? { day: String(day) } : {}),
      },
    });

    return this.toDto(proposal, requester);
  }

  /** owner: 트립의 모든 pending 제안 / 참여자: 본인이 낸 pending 제안 */
  async listForTrip(viewer: UserEntity, tripId: string): Promise<ScheduleChangeListDto> {
    const trip = await this.tripsService.findOneForViewer(tripId, viewer.id);
    const isOwner = trip.userId === viewer.id;
    const proposals = await this.repo.find({
      where: {
        tripId,
        status: 'pending',
        ...(isOwner ? {} : { requesterId: viewer.id }),
      },
      relations: ['requester'],
      order: { createdAt: 'ASC' },
    });
    return { proposals: proposals.map((p) => this.toDto(p, p.requester)) };
  }

  /** 단건 조회 (owner diff 미리보기 / 참여자 본인 확인) */
  async getOne(viewer: UserEntity, id: string): Promise<ScheduleChangeProposalDto> {
    const proposal = await this.load(id);
    const trip = await this.tripsService.findOneForViewer(proposal.tripId, viewer.id);
    const isOwner = trip.userId === viewer.id;
    if (!isOwner && proposal.requesterId !== viewer.id) {
      throw new ForbiddenException();
    }
    return this.toDto(proposal, proposal.requester);
  }

  /**
   * pending → next 로 원자적 선점. 동시 승인/거절/취소가 겹쳐도 단 하나만 성공한다
   * (check-then-act 레이스로 인한 중복 반영·중복 알림 방지). 이미 처리됐으면 BadRequest.
   */
  private async claim(id: string, next: 'approved' | 'rejected' | 'cancelled'): Promise<void> {
    const result = await this.repo.update(
      { id, status: 'pending' },
      { status: next, resolvedAt: new Date() },
    );
    if (!result.affected) {
      throw new BadRequestException('이미 처리된 요청이에요.');
    }
  }

  /** owner 승인 — payload 를 owner 권한으로 재실행하고 요청자에게 결과 알림 */
  async approve(owner: UserEntity, id: string): Promise<ScheduleChangeProposalDto> {
    const proposal = await this.load(id);
    // owner 전용 — trip.userId !== owner.id 면 findOne 이 Forbidden
    await this.tripsService.findOne(proposal.tripId, owner.id);
    // 원자적 선점(레이스 방지). 성공한 요청만 실제 반영으로 진행한다.
    await this.claim(id, 'approved');
    proposal.status = 'approved';

    try {
      await this.apply(owner, proposal);
    } catch (err) {
      proposal.status = 'failed';
      await this.repo.update({ id }, { status: 'failed' });
      await this.inboxService.cancelScheduleChangeRequest(owner.id, proposal.id);
      await this.notifyResult(proposal, 'failed');
      this.logger.warn(`schedule change ${id} apply failed: ${String(err)}`);
      throw new BadRequestException(
        '변경을 반영하지 못했어요. 일정이 이미 바뀌었을 수 있어요.',
      );
    }

    await this.inboxService.cancelScheduleChangeRequest(owner.id, proposal.id);
    await this.notifyResult(proposal, 'approved');
    return this.toDto(proposal, proposal.requester);
  }

  /** owner 거절 */
  async reject(owner: UserEntity, id: string): Promise<ScheduleChangeProposalDto> {
    const proposal = await this.load(id);
    await this.tripsService.findOne(proposal.tripId, owner.id);
    await this.claim(id, 'rejected');
    proposal.status = 'rejected';
    await this.inboxService.cancelScheduleChangeRequest(owner.id, proposal.id);
    await this.notifyResult(proposal, 'rejected');
    return this.toDto(proposal, proposal.requester);
  }

  /** 요청자 본인 취소 — owner 승인 요청 카드도 함께 정리 */
  async cancel(requester: UserEntity, id: string): Promise<void> {
    const proposal = await this.load(id);
    if (proposal.requesterId !== requester.id) {
      throw new ForbiddenException();
    }
    await this.claim(id, 'cancelled');
    // owner 쪽 승인 요청 카드 제거(취소된 요청에 승인/거절 버튼이 남으면 안 됨)
    const trip = await this.tripsService.findOneForViewer(proposal.tripId, requester.id);
    await this.inboxService.cancelScheduleChangeRequest(trip.userId, proposal.id);
  }

  /** payload 를 owner 권한으로 재실행 — 검증된 기존 서비스 경로를 그대로 탄다 */
  private async apply(owner: UserEntity, proposal: ScheduleChangeProposalEntity): Promise<void> {
    const { tripId } = proposal;
    const payload = proposal.payload;
    switch (payload.kind) {
      case 'add_item':
        await this.mainPlannerService.addItem(owner, tripId, payload.body);
        return;
      case 'update_item':
        await this.mainPlannerService.updateItem(owner, tripId, payload.itemId, payload.body);
        return;
      case 'delete_item':
        await this.mainPlannerService.deleteItem(owner, tripId, payload.itemId);
        return;
      case 'reorder_items':
        await this.mainPlannerService.reorderItems(owner, tripId, payload.body);
        return;
      case 'swap':
        await this.mainPlannerService.swap(owner, tripId, payload.body);
        return;
      case 'replan':
        await this.replanningService.enqueue(owner.id, { ...payload.body, tripId });
        return;
      default: {
        // 알 수 없는 kind 는 조용히 no-op 되면 안 된다 — 승인 실패 경로로 흘려보낸다.
        const _exhaustive: never = payload;
        throw new BadRequestException(`지원하지 않는 변경 유형이에요: ${String((_exhaustive as { kind?: string })?.kind)}`);
      }
    }
  }

  private async notifyResult(
    proposal: ScheduleChangeProposalEntity,
    result: 'approved' | 'rejected' | 'failed',
  ): Promise<void> {
    const title =
      result === 'approved'
        ? '일정 변경이 반영됐어요'
        : result === 'rejected'
          ? '일정 변경이 거절됐어요'
          : '일정 변경을 반영하지 못했어요';
    const body =
      result === 'approved'
        ? `"${proposal.summary}" 요청이 일정에 반영됐어요.`
        : result === 'rejected'
          ? `"${proposal.summary}" 요청이 반려됐어요.`
          : `"${proposal.summary}" 요청 반영에 실패했어요. 다시 시도해 주세요.`;
    await this.inboxService.create({
      userId: proposal.requesterId,
      category: 'schedule_change_result',
      title,
      body,
      payload: {
        tripId: proposal.tripId,
        ...(proposal.day ? { day: String(proposal.day) } : {}),
      },
    });
  }

  /** payload 에서 딥링크·미리보기용 day / targetItemId 추출 */
  private locate(payload: ScheduleChangePayload): { day?: number; targetItemId?: string } {
    switch (payload.kind) {
      case 'add_item':
        return { day: payload.body.day };
      case 'reorder_items':
        return { day: payload.body.day };
      case 'update_item':
      case 'delete_item':
        return { targetItemId: payload.itemId };
      case 'swap':
        return { targetItemId: payload.body.itemId };
      case 'replan':
        return {};
    }
  }

  /** 사람이 읽는 한 줄 요약. 대상 항목명은 현재 일정에서 조회(사라졌으면 일반 문구) */
  private async buildSummary(tripId: string, payload: ScheduleChangePayload): Promise<string> {
    switch (payload.kind) {
      case 'add_item':
        return `${payload.body.day}일차에 "${payload.body.name}" 추가`;
      case 'reorder_items':
        return `${payload.body.day}일차 일정 순서 변경`;
      case 'update_item': {
        const item = await this.mainPlannerService.findItemLabel(tripId, payload.itemId);
        return item ? `"${item.name}" 정보 수정` : '일정 항목 수정';
      }
      case 'delete_item': {
        const item = await this.mainPlannerService.findItemLabel(tripId, payload.itemId);
        return item ? `"${item.name}" 삭제` : '일정 항목 삭제';
      }
      case 'swap': {
        const item = await this.mainPlannerService.findItemLabel(tripId, payload.body.itemId);
        const to = payload.body.place.name;
        return item ? `"${item.name}" → "${to}" 대안 변경` : `"${to}"(으)로 대안 변경`;
      }
      case 'replan': {
        const note = payload.body.note?.trim();
        return note ? `AI 재계획 요청: "${note}"` : 'AI 재계획 요청';
      }
    }
  }

  private async load(id: string): Promise<ScheduleChangeProposalEntity> {
    const proposal = await this.repo.findOne({ where: { id }, relations: ['requester'] });
    if (!proposal) {
      throw new NotFoundException('제안을 찾을 수 없어요.');
    }
    return proposal;
  }

  private toDto(
    proposal: ScheduleChangeProposalEntity,
    requester?: UserEntity | null,
  ): ScheduleChangeProposalDto {
    return {
      id: proposal.id,
      tripId: proposal.tripId,
      requester: {
        id: proposal.requesterId,
        nickname: requester?.nickname ?? '참여자',
      },
      kind: proposal.kind,
      summary: proposal.summary,
      payload: proposal.payload,
      status: proposal.status,
      ...(proposal.day != null ? { day: proposal.day } : {}),
      ...(proposal.targetItemId ? { targetItemId: proposal.targetItemId } : {}),
      createdAt: proposal.createdAt.toISOString(),
      ...(proposal.resolvedAt ? { resolvedAt: proposal.resolvedAt.toISOString() } : {}),
    };
  }
}
