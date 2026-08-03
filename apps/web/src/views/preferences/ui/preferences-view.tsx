'use client';

import { SessionGuard } from '@/entities/session';
import { PreferenceSetupForm } from '@/features/preference-setup/ui/preference-setup-form';
import { AppFrame, PageContainer } from '@/shared/ui/app-frame';

export function PreferencesView() {
  return (
    <SessionGuard>
      <PreferencesContent />
    </SessionGuard>
  );
}

/**
 * @MX:NOTE: 목업 시각 언어(앱바 + 4px 진행바)를 그대로 옮긴다(REQ-WVR-020). 실제
 * 온보딩은 단일 연속 폼(취향 → 조건 → 결과)이라 "1/3" 표기는 3단계 흐름 중 첫
 * 단계를 나타내는 안내용 표기이며 별도 폼 상태를 추가하지 않는다.
 */
function PreferencesContent() {
  return (
    <AppFrame themed>
      <div className="wvr-scope">
        <div className="flex items-center gap-1.5 px-2 pb-2 pt-3">
          <span className="flex-1 px-2">
            <span className="block text-[15px] font-bold leading-[1.3] text-[color:var(--ink)]">
              취향 설정
            </span>
          </span>
          <span className="font-mono text-[12px] font-semibold text-[color:var(--ink-faint)]">
            1/3
          </span>
        </div>
        <div
          className="mx-4 h-1 overflow-hidden rounded-full"
          style={{ background: 'var(--line)' }}
          role="progressbar"
          aria-valuenow={1}
          aria-valuemin={0}
          aria-valuemax={3}
          aria-label="진행 단계"
        >
          <span
            className="block h-full rounded-full"
            style={{ width: '33.3%', background: 'var(--primary)' }}
          />
        </div>
        {/* 목업 frame-body 도입부(eyebrow → 질문형 헤드라인 → 보조 문구). 실제 화면은
            사진 분석으로 시작해 직접 입력으로 이어지므로 질문도 사진을 향한다. */}
        <div className="px-4 pb-1 pt-5">
          <h1 className="wvr-rise wvr-rise-2 text-balance text-[23px] font-extrabold leading-[1.36] tracking-[-0.03em] text-[color:var(--ink)]">
            어떤 장면에
            <br />
            오래 머무나요?
          </h1>
          <p className="wvr-rise wvr-rise-3 mt-2.5 text-[14.5px] leading-[1.62] text-[color:var(--ink-sub)]">
            갤러리에서 좋아하는 사진을 골라 주세요. 질문 대신, 사진이 취향을 말해줘요.
          </p>
        </div>
      </div>
      <PageContainer>
        <PreferenceSetupForm />
      </PageContainer>
    </AppFrame>
  );
}
