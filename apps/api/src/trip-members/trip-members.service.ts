import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PreferencesService } from '../preferences/preferences.service';
import { TripEntity } from '../trips/trip.entity';
import { UserEntity } from '../users/user.entity';
import { TripMemberEntity } from './trip-member.entity';
import type {
  CreateTripMemberDto,
  PreferenceCoordinationDto,
  PreferenceVoteDto,
  TasteTagDto,
  TripBudgetLevel,
  TripMemberDto,
  TripMemberPreferenceDto,
  UpdateTripMemberDto,
} from '@tripick/types';

const MEMBER_COLORS = ['#3182F6', '#00A881', '#F97316', '#8B5CF6', '#64748B', '#EC4899'];

const DEFAULT_MEMBER_PREFERENCE: TripMemberPreferenceDto = {
  food: ['korean'],
  mood: ['healing'],
  environment: ['city'],
  transportMode: 'transit',
  budgetLevel: 'medium',
};

const LABELS: Record<string, string> = {
  korean: '한식·전통',
  japanese: '일식',
  western: '양식',
  chinese: '중식',
  vegan: '가벼운 식사',
  cafe: '카페',
  healing: '힐링',
  adventure: '액티비티',
  romantic: '감도 있는 코스',
  family: '부담 적은 동선',
  cultural: '문화·역사',
  nature: '자연',
  city: '도시',
  beach: '바다',
  mountain: '산·숲',
  village: '로컬 골목',
  walk: '도보',
  transit: '대중교통',
  car: '차량',
  low: '낮음',
  medium: '중간',
  high: '높음',
};

@Injectable()
export class TripMembersService {
  constructor(
    @InjectRepository(TripMemberEntity)
    private readonly membersRepo: Repository<TripMemberEntity>,
    @InjectRepository(TripEntity)
    private readonly tripsRepo: Repository<TripEntity>,
    private readonly preferencesService: PreferencesService,
  ) {}

  async findAll(tripId: string, user: UserEntity): Promise<TripMemberDto[]> {
    await this.ensureOwnerMember(tripId, user);
    const members = await this.membersRepo.find({
      where: { tripId },
      order: { role: 'DESC', createdAt: 'ASC' },
    });
    return members.map((member) => this.toDto(member));
  }

  async create(tripId: string, userId: string, dto: CreateTripMemberDto): Promise<TripMemberDto> {
    await this.assertTripOwner(tripId, userId);
    const nickname = dto.nickname.trim();
    if (!nickname) {
      throw new BadRequestException('nickname is required');
    }

    const count = await this.membersRepo.count({ where: { tripId } });
    const member = this.membersRepo.create({
      tripId,
      nickname,
      contact: dto.contact?.trim() || null,
      kakaoId: dto.kakaoId?.trim() || null,
      relation: dto.relation?.trim() || null,
      role: 'companion',
      status: dto.status ?? 'accepted',
      color: MEMBER_COLORS[count % MEMBER_COLORS.length] ?? MEMBER_COLORS[0]!,
      preferenceTags: this.mergePreference(dto.preferenceTags),
    });
    return this.toDto(await this.membersRepo.save(member));
  }

  async update(
    tripId: string,
    memberId: string,
    userId: string,
    dto: UpdateTripMemberDto,
  ): Promise<TripMemberDto> {
    await this.assertTripOwner(tripId, userId);
    const member = await this.membersRepo.findOneBy({ id: memberId, tripId });
    if (!member) {
      throw new NotFoundException(`Trip member ${memberId} not found`);
    }

    if (dto.nickname !== undefined) {
      const nickname = dto.nickname.trim();
      if (!nickname) {
        throw new BadRequestException('nickname is required');
      }
      member.nickname = nickname;
    }
    if (dto.contact !== undefined) member.contact = dto.contact?.trim() || null;
    if (dto.kakaoId !== undefined) member.kakaoId = dto.kakaoId?.trim() || null;
    if (dto.relation !== undefined) member.relation = dto.relation?.trim() || null;
    if (dto.status !== undefined) member.status = dto.status;
    if (dto.preferenceTags !== undefined) {
      member.preferenceTags = this.mergePreference(dto.preferenceTags, member.preferenceTags);
    }

    return this.toDto(await this.membersRepo.save(member));
  }

  async remove(tripId: string, memberId: string, userId: string): Promise<void> {
    await this.assertTripOwner(tripId, userId);
    const member = await this.membersRepo.findOneBy({ id: memberId, tripId });
    if (!member) {
      throw new NotFoundException(`Trip member ${memberId} not found`);
    }
    if (member.role === 'owner') {
      throw new BadRequestException('owner member cannot be removed');
    }
    await this.membersRepo.remove(member);
  }

  async getCoordination(tripId: string, user: UserEntity): Promise<PreferenceCoordinationDto> {
    const members = await this.findAll(tripId, user);
    const ownerPreference = await this.preferencesService.findByUser(user.id);
    const ownerTasteTags = ownerPreference?.tasteTags;

    return {
      tripId,
      members,
      consensus: {
        food: this.vote(members, (member) => member.preferenceTags.food),
        mood: this.vote(members, (member) => member.preferenceTags.mood),
        environment: this.vote(members, (member) => member.preferenceTags.environment),
        transportMode: this.vote(members, (member) => [member.preferenceTags.transportMode]),
        budgetLevel: this.vote(members, (member) => [member.preferenceTags.budgetLevel]),
      },
      recommendation: this.buildRecommendation(members),
      ...(ownerTasteTags ? { ownerTasteTags } : {}),
      updatedAt: new Date().toISOString(),
    };
  }

  private async assertTripOwner(tripId: string, userId: string): Promise<TripEntity> {
    const trip = await this.tripsRepo.findOneBy({ id: tripId });
    if (!trip) {
      throw new NotFoundException(`Trip ${tripId} not found`);
    }
    if (trip.userId !== userId) {
      throw new ForbiddenException();
    }
    return trip;
  }

  private async ensureOwnerMember(tripId: string, user: UserEntity): Promise<void> {
    await this.assertTripOwner(tripId, user.id);
    const existing = await this.membersRepo.findOneBy({ tripId, userId: user.id });
    const preference = await this.preferencesService.findByUser(user.id);
    const preferenceTags = this.fromTasteTags(preference?.tasteTags);

    if (existing) {
      if (existing.role !== 'owner' || existing.nickname !== user.nickname) {
        existing.role = 'owner';
        existing.nickname = user.nickname;
      }
      existing.preferenceTags = preferenceTags;
      await this.membersRepo.save(existing);
      return;
    }

    await this.membersRepo.save(
      this.membersRepo.create({
        tripId,
        userId: user.id,
        nickname: user.nickname,
        role: 'owner',
        status: 'accepted',
        color: MEMBER_COLORS[0]!,
        preferenceTags,
      }),
    );
  }

  private fromTasteTags(tasteTags?: TasteTagDto): TripMemberPreferenceDto {
    if (!tasteTags) {
      return DEFAULT_MEMBER_PREFERENCE;
    }
    return {
      food: tasteTags.food.length > 0 ? tasteTags.food : DEFAULT_MEMBER_PREFERENCE.food,
      mood: tasteTags.mood.length > 0 ? tasteTags.mood : DEFAULT_MEMBER_PREFERENCE.mood,
      environment:
        tasteTags.environment.length > 0
          ? tasteTags.environment
          : DEFAULT_MEMBER_PREFERENCE.environment,
      transportMode: DEFAULT_MEMBER_PREFERENCE.transportMode,
      budgetLevel: DEFAULT_MEMBER_PREFERENCE.budgetLevel,
    };
  }

  private mergePreference(
    incoming: Partial<TripMemberPreferenceDto> | undefined,
    base: TripMemberPreferenceDto = DEFAULT_MEMBER_PREFERENCE,
  ): TripMemberPreferenceDto {
    return {
      food: [...new Set(incoming?.food ?? base.food ?? DEFAULT_MEMBER_PREFERENCE.food)],
      mood: [...new Set(incoming?.mood ?? base.mood ?? DEFAULT_MEMBER_PREFERENCE.mood)],
      environment: [
        ...new Set(
          incoming?.environment ?? base.environment ?? DEFAULT_MEMBER_PREFERENCE.environment,
        ),
      ],
      transportMode:
        incoming?.transportMode ?? base.transportMode ?? DEFAULT_MEMBER_PREFERENCE.transportMode,
      budgetLevel:
        incoming?.budgetLevel ?? base.budgetLevel ?? DEFAULT_MEMBER_PREFERENCE.budgetLevel,
    };
  }

  private vote(
    members: TripMemberDto[],
    pick: (member: TripMemberDto) => string[],
  ): PreferenceVoteDto[] {
    const buckets = new Map<string, { count: number; memberNames: string[] }>();
    for (const member of members) {
      for (const key of pick(member)) {
        const bucket = buckets.get(key) ?? { count: 0, memberNames: [] };
        bucket.count += 1;
        bucket.memberNames.push(member.nickname);
        buckets.set(key, bucket);
      }
    }
    return Array.from(buckets.entries())
      .map(([key, bucket]) => ({
        key,
        label: LABELS[key] ?? key,
        count: bucket.count,
        memberNames: bucket.memberNames,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko-KR'));
  }

  private buildRecommendation(
    members: TripMemberDto[],
  ): PreferenceCoordinationDto['recommendation'] {
    const food = this.vote(members, (member) => member.preferenceTags.food)[0];
    const mood = this.vote(members, (member) => member.preferenceTags.mood)[0];
    const environment = this.vote(members, (member) => member.preferenceTags.environment)[0];
    const transportMode = this.vote(members, (member) => [member.preferenceTags.transportMode])[0];
    const budget = this.vote(members, (member) => [member.preferenceTags.budgetLevel])[0];
    const memberCount = members.length;

    return {
      title: `${environment?.label ?? '로컬'} 중심 ${food?.label ?? '맛집'} 코스`,
      summary: `${memberCount}명의 공통 취향은 ${[food?.label, mood?.label, environment?.label]
        .filter(Boolean)
        .join(' · ')}입니다.`,
      reasons: [
        `${food?.label ?? '식사'} 선호가 가장 많이 겹칩니다.`,
        `${transportMode?.label ?? '대중교통'} 기준으로 이동 피로를 낮춥니다.`,
        `예산은 ${budget?.label ?? '중간'} 수준으로 맞춥니다.`,
      ],
      scheduleHint: `${mood?.label ?? '힐링'} 성향을 오전에 먼저 배치하고, 식사 전후 이동 거리를 짧게 묶는 구성이 적합합니다.`,
    };
  }

  private toDto(member: TripMemberEntity): TripMemberDto {
    return {
      id: member.id,
      tripId: member.tripId,
      userId: member.userId ?? null,
      nickname: member.nickname,
      contact: member.contact ?? null,
      kakaoId: member.kakaoId ?? null,
      relation: member.relation ?? null,
      role: member.role,
      status: member.status,
      color: member.color,
      preferenceTags: this.mergePreference(member.preferenceTags),
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
    };
  }
}
