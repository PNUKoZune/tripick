import { PreferenceSetupForm } from '@/features/preference-setup/ui/preference-setup-form';
import { AppFrame, PageSection, TopBar } from '@/shared/ui/app-frame';

export function PreferencesView() {
  return (
    <AppFrame>
      <TopBar title="취향 설정" />
      <PageSection>
        <PreferenceSetupForm />
      </PageSection>
    </AppFrame>
  );
}
