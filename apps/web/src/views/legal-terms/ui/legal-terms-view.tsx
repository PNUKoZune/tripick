import { DocumentPageShell } from '@/shared/ui/document-page';
import { TermsContent } from '@/shared/ui/legal/terms-content';
import { LEGAL_UPDATED_AT } from '@/shared/config/contact';

export function LegalTermsView() {
  return (
    <DocumentPageShell label="이용약관" title="이용약관" description={`시행일 ${LEGAL_UPDATED_AT}`}>
      <TermsContent />
    </DocumentPageShell>
  );
}
