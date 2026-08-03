'use client';

import { SessionGuard } from '@/entities/session';
import { PreferenceSetupForm } from '@/features/preference-setup/ui/preference-setup-form';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';

export function PreferencesView() {
  return (
    <SessionGuard>
      <PreferencesContent />
    </SessionGuard>
  );
}

/**
 * 헤더는 친구·알림·설정과 같은 공용 PageHeader 를 쓴다 — 탭으로 오가는 화면들이라
 * 제목 크기·데스크탑 라벨·여백이 화면마다 달라지면 안 된다. 목업의 앱바(4px 진행바 +
 * "1/3" + 질문형 헤드라인)는 온보딩 단발 화면 전제라 실제 흐름과 맞지 않아 걷어냈다.
 */
function PreferencesContent() {
  return (
    <AppFrame themed>
      <PageHeader
        title="취향"
        label="취향"
        description="취향을 저장하면 일정 추천이 더 잘 맞아져요. 사진까지 올리면 더 정확해지고요."
      />
      <PageContainer>
        <PreferenceSetupForm />
      </PageContainer>
    </AppFrame>
  );
}
