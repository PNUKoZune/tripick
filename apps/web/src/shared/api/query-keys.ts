export const queryKeys = {
  preferences: {
    me: ['preferences', 'me'] as const,
  },
  trips: {
    active: ['trips', 'active'] as const,
    members: (tripId: string) => ['trips', tripId, 'members'] as const,
    coordination: (tripId: string) => ['trips', tripId, 'coordination'] as const,
  },
  friends: {
    list: ['friends', 'list'] as const,
  },
  inbox: {
    list: ['inbox', 'list'] as const,
  },
  user: {
    me: ['user', 'me'] as const,
  },
  planner: {
    trips: ['planner', 'trips'] as const,
    trip: (tripId: string) => ['planner', 'trips', tripId] as const,
    members: (tripId: string) => ['planner', 'trips', tripId, 'members'] as const,
    coordination: (tripId: string) => ['planner', 'trips', tripId, 'coordination'] as const,
    share: (tripId: string) => ['planner', 'trips', tripId, 'share'] as const,
    shared: (token: string) => ['planner', 'shared', token] as const,
    alternatives: (tripId: string, itemId: string, note = '') =>
      ['planner', 'trips', tripId, 'alternatives', itemId, note] as const,
    destinations: (query: string) => ['planner', 'destinations', query] as const,
  },
};
