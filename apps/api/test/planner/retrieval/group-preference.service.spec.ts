/// <reference types="jest" />

import {
  GroupPreferenceService,
  normalizedCentroid,
} from '../../../src/planner/retrieval/group-preference.service';

const ownerTaste = {
  food: ['cafe'],
  mood: ['trendy'],
  environment: ['city'],
  confidence: 0.8,
};
const guestTaste = {
  food: ['korean'],
  mood: ['cultural'],
  environment: ['village'],
  confidence: 1,
};

function member(overrides: Record<string, unknown>) {
  return {
    id: 'member-1',
    userId: 'guest',
    status: 'accepted',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    preferenceTags: {
      food: ['korean'],
      mood: ['cultural'],
      environment: ['village'],
      transportMode: 'transit',
      budgetLevel: 'medium',
    },
    ...overrides,
  };
}

function setup(rows: ReturnType<typeof member>[] = []) {
  const membersRepo = { find: jest.fn().mockResolvedValue(rows) };
  const preferences = {
    findByUsers: jest.fn().mockResolvedValue([
      { userId: 'owner', tasteTags: ownerTaste },
      { userId: 'guest', tasteTags: guestTaste },
    ]),
    getPreferenceVectors: jest.fn().mockResolvedValue(
      new Map<string, number[]>([
        ['owner', [1, 0]],
        ['guest', [0, 1]],
      ]),
    ),
  };
  const service = new GroupPreferenceService(membersRepo as never, preferences as never);
  return { service, membersRepo, preferences };
}

describe('GroupPreferenceService', () => {
  it('merges owner and accepted members, batches vectors, and creates a normalized centroid', async () => {
    const { service, membersRepo, preferences } = setup([
      member({ id: 'owner-row', userId: 'owner', role: 'owner' }),
      member({ id: 'guest-row', userId: 'guest' }),
      member({
        id: 'manual-row',
        userId: null,
        preferenceTags: {
          food: [],
          mood: ['adventure'],
          environment: ['nature'],
          transportMode: 'walk',
          budgetLevel: 'low',
        },
      }),
    ]);

    const profile = await service.forTrip('trip-1', 'owner');

    expect(membersRepo.find).toHaveBeenCalledWith({
      where: { tripId: 'trip-1', status: 'accepted' },
      order: { createdAt: 'ASC' },
    });
    expect(preferences.findByUsers).toHaveBeenCalledWith(['owner', 'guest']);
    expect(preferences.getPreferenceVectors).toHaveBeenCalledWith(['owner', 'guest']);
    expect(profile.memberCount).toBe(3);
    expect(profile.vectorMemberCount).toBe(2);
    expect(profile.preferenceVector).toEqual([
      1 / Math.sqrt(2),
      1 / Math.sqrt(2),
    ]);
    expect(profile.memberPreferenceVectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(profile.memberTasteTags).toHaveLength(3);
    expect(profile.tasteTags).toMatchObject({
      food: ['cafe', 'korean'],
      mood: ['trendy', 'cultural', 'adventure'],
      environment: ['city', 'village', 'nature'],
    });
  });

  it('excludes pending rows even if a repository test double returns them', async () => {
    const { service } = setup([
      member({ id: 'guest-row', userId: 'guest' }),
      member({ id: 'pending-row', userId: 'pending-user', status: 'pending' }),
    ]);

    const profile = await service.forTrip('trip-1', 'owner');

    expect(profile.memberCount).toBe(2);
    expect(profile.tasteTags?.food).toEqual(['cafe', 'korean']);
    expect(profile.memberTasteTags).toHaveLength(2);
  });

  it('keeps the dominant vector dimension and does not expose group fairness for one vector', async () => {
    const { service, preferences } = setup([member({ id: 'guest-row', userId: 'guest' })]);
    preferences.getPreferenceVectors.mockResolvedValue(
      new Map<string, number[]>([
        ['owner', [1, 0]],
        ['guest', [0, 1, 0]],
      ]),
    );

    const profile = await service.forTrip('trip-1', 'owner');

    expect(profile.vectorMemberCount).toBe(1);
    expect(profile.preferenceVector).toEqual([1, 0]);
    expect(profile.memberPreferenceVectors).toBeUndefined();
  });

  it('returns an owner-only profile even when the historical owner member row is absent', async () => {
    const { service } = setup([]);

    const profile = await service.forTrip('trip-1', 'owner');

    expect(profile.memberCount).toBe(1);
    expect(profile.preferenceVector).toEqual([1, 0]);
    expect(profile.tasteTags).toEqual(ownerTaste);
  });
});

describe('normalizedCentroid', () => {
  it('rejects mixed dimensions and zero vectors', () => {
    expect(normalizedCentroid([[1, 0], [1, 0, 0]])).toBeUndefined();
    expect(normalizedCentroid([[0, 0]])).toBeUndefined();
  });
});
