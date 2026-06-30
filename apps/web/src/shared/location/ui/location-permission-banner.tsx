'use client';

import { useEffect, useState } from 'react';

type PermissionState = 'unknown' | 'granted' | 'denied' | 'unavailable';

type Props = {
  permission: PermissionState;
};

const COPY: Record<'denied' | 'unavailable', { title: string; message: string }> = {
  denied: {
    title: '위치 권한이 꺼져 있어요',
    message: '경로 안내와 이탈 감지를 위해 위치 권한을 켜주세요.',
  },
  unavailable: {
    title: '현재 위치를 가져올 수 없어요',
    message: '잠시 후 다시 시도하거나, 기기의 위치 서비스를 확인해 주세요.',
  },
};

/**
 * 위치 권한 거부·사용 불가 상태일 때 Live 화면 상단에 뜨는 안내 배너.
 * granted/unknown 이면 아무것도 렌더하지 않는다. 사용자가 닫으면 다시 뜨지 않는다.
 */
export function LocationPermissionBanner({ permission }: Props) {
  const [dismissed, setDismissed] = useState(false);

  // 권한 상태가 정상으로 회복되면 닫힘 상태를 초기화 (이후 다시 막히면 또 안내)
  useEffect(() => {
    if (permission === 'granted' || permission === 'unknown') setDismissed(false);
  }, [permission]);

  if (permission !== 'denied' && permission !== 'unavailable') return null;
  if (dismissed) return null;

  const copy = COPY[permission];

  return (
    <div className="mb-3 flex items-start gap-3 rounded-[14px] border border-[#FFD2D7] bg-[#FFF0F1] px-4 py-3">
      <span aria-hidden className="mt-0.5 text-[16px]">
        📍
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold leading-5 text-[#F04452]">{copy.title}</div>
        <p className="mt-0.5 text-[12px] leading-4 text-[#4E5968]">{copy.message}</p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="닫기"
        className="shrink-0 rounded-md px-1 text-[18px] leading-none text-[#8B95A1] hover:text-[#4E5968]"
      >
        ×
      </button>
    </div>
  );
}
