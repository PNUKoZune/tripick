import { DocumentPageShell } from '@/shared/ui/document-page';
import { PrivacyContent } from '@/shared/ui/legal/privacy-content';
import { LEGAL_UPDATED_AT } from '@/shared/config/contact';

export function LegalPrivacyView() {
  return (
    <DocumentPageShell
      label="개인정보처리방침"
      title="개인정보처리방침"
      description={`시행일 ${LEGAL_UPDATED_AT}`}
    >
      <PrivacyContent />
    </DocumentPageShell>
  );
}
