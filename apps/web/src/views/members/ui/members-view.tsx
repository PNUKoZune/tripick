import { MemberManager } from '@/features/member-management/ui/member-manager';
import { AppFrame, PageSection, TopBar } from '@/shared/ui/app-frame';

export function MembersView() {
  return (
    <AppFrame>
      <TopBar title="멤버 관리" />
      <PageSection>
        <MemberManager />
      </PageSection>
    </AppFrame>
  );
}
