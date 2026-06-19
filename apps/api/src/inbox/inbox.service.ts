import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { FriendEntity } from '../friends/friend.entity';
import { NotificationService } from '../notification/notification.service';
import { UserEntity } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { NotificationEntity } from './notification.entity';
import type {
  CreateNotificationDto,
  InboxItemActionDto,
  InboxItemDto,
  InboxSummaryDto,
} from '@tripick/types';

@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationsRepo: Repository<NotificationEntity>,
    @InjectRepository(FriendEntity)
    private readonly friendsRepo: Repository<FriendEntity>,
    private readonly usersService: UsersService,
    private readonly notificationService: NotificationService,
  ) {}

  async list(user: UserEntity): Promise<InboxSummaryDto> {
    const [notifications, incomingFriends] = await Promise.all([
      this.notificationsRepo.find({
        where: { userId: user.id },
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.friendsRepo.find({
        where: { ownerId: user.id, status: 'incoming' },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const items: InboxItemDto[] = [
      ...incomingFriends.map((friend) => this.fromFriend(friend)),
      ...notifications.map((notification) => this.fromNotification(notification)),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const unreadCount =
      incomingFriends.length + notifications.filter((notification) => !notification.readAt).length;

    return { items, unreadCount };
  }

  async markRead(user: UserEntity, id: string): Promise<InboxItemDto> {
    const notification = await this.notificationsRepo.findOneBy({ id });
    if (!notification) {
      throw new NotFoundException('notification not found');
    }
    if (notification.userId !== user.id) {
      throw new ForbiddenException();
    }
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationsRepo.save(notification);
    }
    return this.fromNotification(notification);
  }

  async markAllRead(user: UserEntity): Promise<{ updated: number }> {
    const result = await this.notificationsRepo.update(
      { userId: user.id, readAt: IsNull() },
      { readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }

  async create(dto: CreateNotificationDto): Promise<NotificationEntity | null> {
    const receiver = await this.usersService.findById(dto.userId);
    if (receiver && !this.usersService.prefersCategory(receiver, dto.category)) {
      return null;
    }
    const saved = await this.notificationsRepo.save(
      this.notificationsRepo.create({
        userId: dto.userId,
        category: dto.category,
        title: dto.title,
        body: dto.body,
        payload: dto.payload ?? null,
        readAt: null,
      }),
    );

    // 푸시 발송은 인박스 저장 결과와 독립 — 실패해도 인박스 row 는 살아있다.
    if (receiver?.fcmToken) {
      void this.notificationService.send(
        {
          userId: dto.userId,
          type: dto.category,
          title: dto.title,
          body: dto.body,
          data: this.stringifyPayload({
            notificationId: saved.id,
            category: dto.category,
            ...(dto.payload ?? {}),
          }),
        },
        receiver.fcmToken,
      );
    }

    return saved;
  }

  /** FCM data payload 는 모든 값이 string 이어야 함 — 타입 보정. */
  private stringifyPayload(payload: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      out[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return out;
  }

  private fromNotification(notification: NotificationEntity): InboxItemDto {
    return {
      id: notification.id,
      kind: notification.category,
      title: notification.title,
      body: notification.body,
      createdAt: notification.createdAt.toISOString(),
      readAt: notification.readAt?.toISOString() ?? null,
      actions: this.actionsForNotification(notification),
      ...(notification.payload ? { payload: notification.payload } : {}),
    };
  }

  private fromFriend(friend: FriendEntity): InboxItemDto {
    const actions: InboxItemActionDto[] = [
      { type: 'accept-friend', label: '수락', friendId: friend.id },
      { type: 'reject-friend', label: '거절', friendId: friend.id },
    ];
    return {
      id: `friend-${friend.id}`,
      kind: 'friend_request',
      title: `${friend.nickname} 님의 친구 요청`,
      body: friend.statusMessage ?? `${friend.handle} 님이 친구를 신청했어요.`,
      createdAt: friend.createdAt.toISOString(),
      readAt: null,
      actions,
    };
  }

  private actionsForNotification(notification: NotificationEntity): InboxItemActionDto[] {
    const tripId = notification.payload?.tripId;
    const tripMemberId = notification.payload?.tripMemberId;
    if (notification.category === 'trip_invite' && tripId && tripMemberId) {
      return [
        { type: 'accept-trip-invite', label: '수락', tripId, tripMemberId },
        { type: 'reject-trip-invite', label: '거절', tripId, tripMemberId },
      ];
    }
    if (
      (notification.category === 'replan_ready' || notification.category === 'trip_reminder') &&
      tripId
    ) {
      return [{ type: 'open-trip', label: '여행 보기', tripId }];
    }
    if (notification.category === 'weather_alert' && tripId) {
      return [{ type: 'open-trip', label: '일정 확인', tripId }];
    }
    if (notification.category === 'general' && tripId) {
      return [{ type: 'open-trip', label: '여행 보기', tripId }];
    }
    return [];
  }
}
