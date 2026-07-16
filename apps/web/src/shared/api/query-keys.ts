export const queryKeys = {
  preferences: {
    me: ['preferences', 'me'] as const,
  },
  trips: {
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
  routes: {
    // 목적지+수단으로만 키를 잡는다. 현재 위치를 키에 넣으면 GPS 갱신마다 캐시가 갈려
    // 폴링 주기가 무력해지므로, 위치는 queryFn 안에서 ref 로 읽는다.
    eta: (to: string, mode: string) => ['routes', 'eta', to, mode] as const,
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
    recommendedDestinations: ['planner', 'destinations', 'recommended'] as const,
  },
};
