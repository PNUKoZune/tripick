import { CoordinationBoard } from '@/features/preference-coordination/ui/coordination-board';
import { AppFrame, PageSection, TopBar } from '@/shared/ui/app-frame';

export function CoordinationView() {
  return (
    <AppFrame>
      <TopBar title="취향 조율" />
      <PageSection>
        <CoordinationBoard />
      </PageSection>
    </AppFrame>
  );
}
