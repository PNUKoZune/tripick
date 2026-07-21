export const queryKeys = {
  preferences: {
    me: ['preferences', 'me'] as const,
    analysisJob: (jobId: string) => ['preferences', 'analysis-job', jobId] as const,
    photoTags: ['preferences', 'photo-tags'] as const,
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
  scheduleChanges: {
    list: (tripId: string) => ['schedule-changes', tripId] as const,
    detail: (id: string) => ['schedule-changes', 'detail', id] as const,
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
    recommendedDestinations: ['planner', 'destinations', 'recommended'] as const,
  },
};
