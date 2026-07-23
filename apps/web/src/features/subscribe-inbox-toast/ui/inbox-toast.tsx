'use client';

import { useRouter } from 'next/navigation';

import { Toast } from '@/shared/ui';

import { useInboxToastSubscription } from '../model/use-inbox-toast-subscription';

/**
 * 앱 전역에 마운트되는 실시간 인박스 토스트(providers).
 * 친구 요청 등 능동 알림이 소켓으로 오면 화면 하단에 heads-up 으로 띄운다.
 * href 가 있으면 탭 시 해당 경로로 이동한다(예: 친구 요청 → /inbox 에서 수락/거절).
 */
export function InboxToast() {
  const router = useRouter();
  const { toast, dismiss } = useInboxToastSubscription();

  if (!toast) return null;

  return (
    <Toast
      tone={toast.tone}
      title={toast.title}
      {...(toast.message ? { message: toast.message } : {})}
      onClose={dismiss}
      {...(toast.href
        ? {
            onClick: () => {
              const href = toast.href;
              dismiss();
              if (href) router.push(href);
            },
          }
        : {})}
    />
  );
}
