'use client';

import { PreferenceSetupForm } from '@/features/preference-setup/ui/preference-setup-form';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';

export function PreferencesView() {
  return (
    <AppFrame>
      <PageHeader
        title="취향 설정"
        label="취향"
        description="내 취향을 저장하면 일정 추천이 더 잘 맞아져요."
      />
      <PageContainer>
        <PreferenceSetupForm />
      </PageContainer>
    </AppFrame>
  );
}
