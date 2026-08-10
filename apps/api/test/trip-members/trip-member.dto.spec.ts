/// <reference types="jest" />

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateTripMemberBodyDto,
  UpdateTripMemberBodyDto,
} from '../../src/trip-members/dto/trip-member.dto';
import { AddFriendRequestBodyDto } from '../../src/friends/dto/friend.dto';

async function violations(dto: object): Promise<string[]> {
  return (await validate(dto)).map((error) => error.property);
}

describe('CreateTripMemberBodyDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateTripMemberBodyDto, {
      nickname: '지민',
      relation: '친구',
      status: 'pending',
      preferenceTags: { transportMode: 'car', budgetLevel: 'medium', food: ['korean'] },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects an empty nickname', async () => {
    const dto = plainToInstance(CreateTripMemberBodyDto, { nickname: '' });
    await expect(violations(dto)).resolves.toContain('nickname');
  });

  it('rejects an unknown status and transportMode', async () => {
    const dto = plainToInstance(CreateTripMemberBodyDto, {
      nickname: '지민',
      status: 'ghosting',
      preferenceTags: { transportMode: 'teleport' },
    });

    await expect(violations(dto)).resolves.toEqual(
      expect.arrayContaining(['status', 'preferenceTags']),
    );
  });
});

describe('UpdateTripMemberBodyDto', () => {
  it('accepts null fields as deletions', async () => {
    const dto = plainToInstance(UpdateTripMemberBodyDto, {
      contact: null,
      kakaoId: null,
      relation: null,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a non-string contact', async () => {
    const dto = plainToInstance(UpdateTripMemberBodyDto, { contact: 42 });
    await expect(violations(dto)).resolves.toContain('contact');
  });
});

describe('AddFriendRequestBodyDto', () => {
  it('accepts a handle', async () => {
    const dto = plainToInstance(AddFriendRequestBodyDto, { handle: 'koty' });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a non-string handle', async () => {
    // 서비스가 handle.trim() 을 부르므로 문자열이 아니면 500 이 된다.
    const dto = plainToInstance(AddFriendRequestBodyDto, { handle: { $ne: null } });
    await expect(violations(dto)).resolves.toContain('handle');
  });

  it('rejects an empty handle', async () => {
    const dto = plainToInstance(AddFriendRequestBodyDto, { handle: '' });
    await expect(violations(dto)).resolves.toContain('handle');
  });
});
