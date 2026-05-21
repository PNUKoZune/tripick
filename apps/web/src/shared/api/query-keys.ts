export const queryKeys = {
  preferences: {
    me: ['preferences', 'me'] as const,
  },
  trips: {
    active: ['trips', 'active'] as const,
    members: (tripId: string) => ['trips', tripId, 'members'] as const,
    coordination: (tripId: string) => ['trips', tripId, 'coordination'] as const,
  },
  planner: {
    trips: ['planner', 'trips'] as const,
    trip: (tripId: string) => ['planner', 'trips', tripId] as const,
    alternatives: (tripId: string, itemId: string) =>
      ['planner', 'trips', tripId, 'alternatives', itemId] as const,
    destinations: (query: string) => ['planner', 'destinations', query] as const,
  },
};
