import type { Metadata } from 'next';
import type { SharedItineraryDto } from '@tripick/types';

import { SharedTripView } from '@/views/shared-trip';

// 서버 컴포넌트에서는 브라우저용 상대경로 프록시(/api/v1) 대신 백엔드 오리진을 직접 친다.
// next.config.mjs 의 rewrites 가 쓰는 것과 같은 env 를 공유한다.
const API_ORIGIN = process.env.TRIPICK_API_ORIGIN ?? 'http://127.0.0.1:4000';

/**
 * 공유 링크 미리보기 카드(OG·트위터)에 여행 제목·목적지를 싣는다.
 * 공개 엔드포인트라 인증 불필요. 조회 실패 시 루트 metadata(기본 카드)로 폴백.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/shared-itineraries/${token}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return {};
    const trip = (await res.json()) as SharedItineraryDto;
    const title = `${trip.title} — TriPick 공유 일정`;
    const description = `${trip.destination} · ${trip.durationLabel} · TriPick 으로 함께 짠 여행 일정을 확인해 보세요`;
    return {
      title,
      description,
      openGraph: { title, description },
      twitter: { card: 'summary_large_image', title, description },
    };
  } catch {
    return {};
  }
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedTripView token={token} />;
}
