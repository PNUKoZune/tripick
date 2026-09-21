import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter } from 'node:events';
import type { JwtPayload } from '@tripick/types';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserEntity } from '../users/user.entity';

export type SessionRevocation = { userId?: string; sid?: string };

@Injectable()
export class AccessSessionsService {
  private readonly events = new EventEmitter();

  constructor(
    @InjectRepository(RefreshTokenEntity) private readonly sessions: Repository<RefreshTokenEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  async validate(payload: JwtPayload): Promise<UserEntity> {
    if (!payload.sub || !payload.sid || !payload.exp || payload.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException();
    }
    // The first refresh row is the stable session root across token rotations.
    const root = await this.sessions.findOneBy({ id: payload.sid, userId: payload.sub });
    if (!root || root.revokedAt) throw new UnauthorizedException();
    const user = await this.users.findOneBy({ id: payload.sub });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  onRevoked(listener: (revocation: SessionRevocation) => void): () => void {
    this.events.on('revoked', listener);
    return () => this.events.off('revoked', listener);
  }

  invalidate(revocation: SessionRevocation): void {
    this.events.emit('revoked', revocation);
  }
}
