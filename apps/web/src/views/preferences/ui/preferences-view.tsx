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
 * 앱바 + 질문형 헤드라인. 목업의 4px 진행바("1/3")는 뺐다 — 취향 설정은 탭에서
 * 언제든 다시 들어오는 화면이라 온보딩식 단계 표기가 실제 흐름과 맞지 않는다.
 */
function PreferencesContent() {
  return (
    <AppFrame themed>
      <div className="wvr-scope">
        <div className="px-4 pb-2 pt-3">
          <span className="block text-[15px] font-bold leading-[1.3] text-[color:var(--ink)]">
            취향 설정
          </span>
        </div>
        {/* 목업 frame-body 도입부(질문형 헤드라인 → 보조 문구). 폼은 테마·시간·이동수단
            같은 직접 입력으로 시작하고 사진 분석이 마지막이라, 질문도 취향 전반을 향한다. */}
        <div className="px-4 pb-1 pt-3">
          <h1 className="wvr-rise wvr-rise-2 text-balance text-[23px] font-extrabold leading-[1.36] tracking-[-0.03em] text-[color:var(--ink)]">
            어떤 여행에
            <br />
            마음이 머무나요?
          </h1>
          <p className="wvr-rise wvr-rise-3 mt-2.5 text-[14.5px] leading-[1.62] text-[color:var(--ink-sub)]">
            취향을 저장하면 일정 추천이 더 잘 맞아져요. 마지막에 사진까지 올리면 더
            정확해지고요.
          </p>
        </div>
      </div>
      <PageContainer>
        <PreferenceSetupForm />
      </PageContainer>
    </AppFrame>
  );
}
