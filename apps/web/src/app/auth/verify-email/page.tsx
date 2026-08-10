import { Suspense } from 'react';
import { VerifyEmailView } from '@/views/verify-email/ui/verify-email-view';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailView />
    </Suspense>
  );
}
