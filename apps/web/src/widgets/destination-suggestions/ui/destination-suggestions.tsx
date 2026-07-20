'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { fetchRecommendedDestinations } from '@/entities/trip-plan';
import { queryKeys } from '@/shared/api/query-keys';

/**
 * 취향 기반 추천 여행지를 카드로 노출해 원탭으로 여행 생성(프리필)에 진입시킨다.
 * 서버가 취향 벡터로 지역을 랭킹하며, 취향 데이터가 없으면 인기순으로 폴백한다.
 */
export function DestinationSuggestions() {
  const { data = [] } = useQuery({
    queryKey: queryKeys.planner.recommendedDestinations,
    queryFn: fetchRecommendedDestinations,
    staleTime: 30 * 60 * 1000,
  });

  if (data.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between px-4 lg:px-0">
        <h2 className="text-[15px] font-bold text-[#191F28]">이런 여행지 어때요?</h2>
        <span className="text-[12px] text-[#8B95A1]">취향·인기 반영</span>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 lg:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {data.map((d) => (
          <Link
            key={d.id}
            href={`/trips/new?destination=${encodeURIComponent(d.name)}`}
            className="group flex min-w-[132px] flex-col gap-2 rounded-[16px] border border-[#E5E8EB] bg-white p-4 transition hover:border-[#C7DCFF] hover:shadow-[0_8px_20px_rgba(49,130,246,0.10)]"
          >
            <span className="text-[14px] font-bold text-[#191F28]">{d.name}</span>
            <span className="text-[12px] text-[#8B95A1]">{d.region}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
