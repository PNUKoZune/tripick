import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboxService } from '../inbox/inbox.service';
import { UserEntity } from '../users/user.entity';
import { FriendEntity } from './friend.entity';
import type { AddFriendRequestDto, FriendDto, FriendStatus } from '@tripick/types';

const FRIEND_COLORS = ['#3182F6', '#00A86B', '#FF8A00', '#6B7684', '#191F28', '#7C3AED', '#F04452'];
export type ResolvedFriendDto = FriendDto & { friendUserId?: string | null };

@Injectable()
export class FriendsService {
  constructor(
    @InjectRepository(FriendEntity)
    private readonly friendsRepo: Repository<FriendEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    private readonly inboxService: InboxService,
  ) {}

  async list(ownerId: string): Promise<FriendDto[]> {
    const friends = await this.friendsRepo.find({
      where: { ownerId },
      relations: { friendUser: true },
      order: { pinned: 'DESC', status: 'ASC', createdAt: 'ASC' },
    });
    return friends.map((friend) => this.toDto(friend));
  }

  async add(owner: UserEntity, dto: AddFriendRequestDto): Promise<FriendDto> {
    const handle = this.normalizeHandle(dto.handle);
    const handleKey = handle.slice(1);
    if (!handleKey) {
      throw new BadRequestException('상대방 아이디를 입력해주세요.');
    }
    if (this.isSelfHandle(owner, handleKey)) {
      throw new BadRequestException('내 계정은 친구로 추가할 수 없어요.');
    }

    const existing = await this.friendsRepo.findOneBy({ ownerId: owner.id, handle });
    if (existing) {
      throw new ConflictException('이미 친구 목록에 있는 사용자입니다.');
    }

    const friendUser = await this.findUserByHandle(handleKey);
    const status: FriendStatus = friendUser ? 'pending' : 'accepted';
    const saved = await this.friendsRepo.save(
      this.friendsRepo.create({
        ownerId: owner.id,
        friendUserId: friendUser?.id ?? null,
        nickname: friendUser?.nickname ?? this.nicknameFromHandle(handle),
        handle,
        color: this.colorFromString(handle),
        initial: this.initialFromName(friendUser?.nickname ?? handleKey),
        status,
        pinned: false,
        statusMessage: friendUser ? '친구 요청을 보냈어요.' : '직접 등록한 여행 친구',
      }),
    );

    if (friendUser) {
      await this.createIncomingRequest(friendUser, owner);
    }

    // save() 결과엔 관계가 안 실리므로, 이미 조회한 friendUser 를 붙여 프로필 사진을 즉시 반영한다.
    saved.friendUser = friendUser ?? null;
    return this.toDto(saved);
  }

  async accept(ownerId: string, id: string): Promise<FriendDto> {
    const friend = await this.findOwned(id, ownerId);
    if (friend.status !== 'incoming') {
      throw new BadRequestException('수락할 수 있는 친구 요청이 아닙니다.');
    }

    friend.status = 'accepted';
    friend.statusMessage = '함께 여행할 수 있어요.';
    const saved = await this.friendsRepo.save(friend);

    if (friend.friendUserId) {
      const reciprocal = await this.friendsRepo.findOneBy({
        ownerId: friend.friendUserId,
        friendUserId: ownerId,
      });
      if (reciprocal) {
        reciprocal.status = 'accepted';
        reciprocal.statusMessage = '함께 여행할 수 있어요.';
        await this.friendsRepo.save(reciprocal);
      }
    }

    return this.toDto(saved);
  }

  async togglePin(ownerId: string, id: string): Promise<FriendDto> {
    const friend = await this.findOwned(id, ownerId);
    friend.pinned = !friend.pinned;
    return this.toDto(await this.friendsRepo.save(friend));
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const friend = await this.findOwned(id, ownerId);
    await this.friendsRepo.remove(friend);

    // 보낸 요청(pending) 취소 시, 상대방에 남은 incoming 행도 함께 정리한다.
    // (정리하지 않으면 상대 '받은 요청'에 유령 요청이 남는다)
    if (friend.status === 'pending' && friend.friendUserId) {
      const reciprocal = await this.friendsRepo.findOneBy({
        ownerId: friend.friendUserId,
        friendUserId: ownerId,
        status: 'incoming',
      });
      if (reciprocal) {
        await this.friendsRepo.remove(reciprocal);
        // 상대 '받은 요청' 인박스에 남은 친구 요청 카드가 즉시 사라지도록 갱신 신호를 쏜다.
        this.inboxService.pushInboxRefresh(friend.friendUserId);
      }
    }
  }

  async findAcceptedById(ownerId: string, id: string): Promise<ResolvedFriendDto> {
    const friend = await this.findOwned(id, ownerId);
    if (friend.status !== 'accepted') {
      throw new ForbiddenException('아직 여행에 추가할 수 있는 친구가 아닙니다.');
    }
    return this.toResolvedDto(friend);
  }

  private async createIncomingRequest(recipient: UserEntity, requester: UserEntity): Promise<void> {
    const handle = this.userHandle(requester);
    const existing = await this.friendsRepo.findOne({
      where: [
        { ownerId: recipient.id, friendUserId: requester.id },
        { ownerId: recipient.id, handle },
      ],
    });
    if (existing) {
      if (!existing.friendUserId) {
        existing.friendUserId = requester.id;
        await this.friendsRepo.save(existing);
      }
      return;
    }
    await this.friendsRepo.save(
      this.friendsRepo.create({
        ownerId: recipient.id,
        friendUserId: requester.id,
        nickname: requester.nickname,
        handle,
        color: this.colorFromString(handle),
        initial: this.initialFromName(requester.nickname),
        status: 'incoming',
        pinned: false,
        statusMessage: '친구 요청을 보냈어요.',
      }),
    );

    // 새 incoming 요청이 생성된 경우에만 푸시 — 중복 요청(early return)엔 재발송하지 않는다.
    await this.inboxService.notifyFriendRequest(recipient, requester);
    // 가상 row 라 create 를 안 거치므로 인박스 실시간 갱신 신호를 직접 쏜다(푸시 토글과 무관).
    this.inboxService.pushInboxRefresh(recipient.id);
  }

  private async findOwned(id: string, ownerId: string): Promise<FriendEntity> {
    const friend = await this.friendsRepo.findOne({
      where: { id },
      relations: { friendUser: true },
    });
    if (!friend) {
      throw new NotFoundException('friend not found');
    }
    if (friend.ownerId !== ownerId) {
      throw new ForbiddenException();
    }
    return friend;
  }

  /**
   * 친구 검색은 고유 핸들로만. (email·nickname 퍼지 매칭은 PII enumeration·동명이인 오매칭이라 제거)
   * 카카오/이메일 가입 구분 없이 동일하게 동작.
   */
  private async findUserByHandle(handleKey: string): Promise<UserEntity | null> {
    return this.usersRepo.findOneBy({ handle: handleKey.toLowerCase() });
  }

  private normalizeHandle(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      throw new BadRequestException('상대방 아이디를 입력해주세요.');
    }
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  }

  private nicknameFromHandle(handle: string): string {
    return (
      handle
        .replace(/^@/, '')
        .replace(/[._-]+/g, ' ')
        .trim() || handle
    );
  }

  private initialFromName(name: string): string {
    return (name.trim().replace(/^@/, '')[0] ?? '?').toUpperCase();
  }

  private isSelfHandle(owner: UserEntity, handleKey: string): boolean {
    return Boolean(owner.handle) && owner.handle === handleKey.toLowerCase();
  }

  private userHandle(user: UserEntity): string {
    return `@${user.handle ?? user.nickname}`;
  }

  private colorFromString(value: string): string {
    let sum = 0;
    for (const ch of value) {
      sum = (sum + ch.charCodeAt(0)) % 997;
    }
    return FRIEND_COLORS[sum % FRIEND_COLORS.length] ?? '#3182F6';
  }

  private toDto(friend: FriendEntity): FriendDto {
    return {
      id: friend.id,
      nickname: friend.nickname,
      handle: friend.handle,
      color: friend.color,
      initial: friend.initial,
      ...(friend.friendUser?.profileImageUrl
        ? { profileImageUrl: friend.friendUser.profileImageUrl }
        : {}),
      ...(friend.emoji ? { emoji: friend.emoji } : {}),
      ...(friend.statusMessage ? { statusMessage: friend.statusMessage } : {}),
      status: friend.status,
      pinned: friend.pinned,
      createdAt: friend.createdAt.toISOString(),
    };
  }

  private toResolvedDto(friend: FriendEntity): ResolvedFriendDto {
    return {
      ...this.toDto(friend),
      friendUserId: friend.friendUserId,
    };
  }
}
