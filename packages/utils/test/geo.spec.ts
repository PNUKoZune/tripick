/// <reference types="jest" />

import { haversineMeters } from '../src/geo';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    const p = { lat: 37.5665, lng: 126.978 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it('is symmetric', () => {
    const a = { lat: 37.5665, lng: 126.978 };
    const b = { lat: 35.1796, lng: 129.0756 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 5);
  });

  it('matches the known Seoul→Busan great-circle distance (~325km)', () => {
    const seoul = { lat: 37.5665, lng: 126.978 };
    const busan = { lat: 35.1796, lng: 129.0756 };
    const meters = haversineMeters(seoul, busan);
    expect(meters).toBeGreaterThan(320_000);
    expect(meters).toBeLessThan(330_000);
  });

  it('computes a short deviation distance (~150m) for route drift', () => {
    const a = { lat: 37.5665, lng: 126.978 };
    const b = { lat: 37.5665 + 0.00135, lng: 126.978 }; // 위도 0.00135도 ≈ 150m
    const meters = haversineMeters(a, b);
    expect(meters).toBeGreaterThan(140);
    expect(meters).toBeLessThan(160);
  });
});
