import { Suspense } from 'react';
import { ResetPasswordView } from '@/views/reset-password/ui/reset-password-view';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordView />
    </Suspense>
  );
}
