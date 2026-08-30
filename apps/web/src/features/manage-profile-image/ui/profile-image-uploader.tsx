'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@tripick/types';

import { removeProfileImage, UserAvatar, uploadProfileImage } from '@/entities/user';
import { queryKeys } from '@/shared/api/query-keys';
import { AVATAR_MAX_DIMENSION, downscaleImage } from '@/shared/lib';

import { ProfileImageMenu } from './profile-image-menu';

type Props = {
  me: UserDto | null | undefined;
  onError?: (error: Error | null) => void;
};

/**
 * 아바타 + 카메라 배지 + 액션 시트(변경 / 기본 복구) 를 묶은 단일 기능.
 * 아바타 클릭으로 시트 열림, 파일 피커는 시트 안에서 트리거.
 */
export function ProfileImageUploader({ me, onError }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const invalidateMe = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.user.me });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) =>
      uploadProfileImage(
        await downscaleImage(file, { maxDimension: AVATAR_MAX_DIMENSION }),
      ),
    onSuccess: () => {
      invalidateMe();
      onError?.(null);
    },
    onError: (err) => onError?.(err instanceof Error ? err : null),
  });

  const removeMutation = useMutation({
    mutationFn: () => removeProfileImage(),
    onSuccess: () => {
      invalidateMe();
      onError?.(null);
    },
    onError: (err) => onError?.(err instanceof Error ? err : null),
  });

  const pending = uploadMutation.isPending || removeMutation.isPending;
  const hasCustomImage = Boolean(me?.profileImageUrl);

  function handlePickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    uploadMutation.mutate(file);
  }

  function openImagePicker() {
    setMenuOpen(false);
    fileInputRef.current?.click();
  }

  function handleRevert() {
    setMenuOpen(false);
    removeMutation.mutate();
  }

  return (
    <>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => me && setMenuOpen(true)}
          disabled={!me || pending}
          aria-label="프로필 사진 옵션"
          className="relative rounded-full shadow-sm ring-1 ring-[color:var(--line,#E4E9F2)] transition hover:opacity-95 disabled:opacity-60"
        >
          <UserAvatar user={me} size="xl" />
          {pending ? (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30 text-[11px] font-bold text-white">
              업로드 중…
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => me && setMenuOpen(true)}
          disabled={!me || pending}
          aria-label="프로필 사진 옵션"
          className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full border-2 border-[color:var(--card,#FFFFFF)] bg-[color:var(--primary,#3182F6)] text-white shadow-sm transition hover:bg-[color:var(--primary-deep,#1B64DA)] disabled:opacity-60 lg:size-9 lg:-bottom-1 lg:-right-1"
        >
          <CameraBadgeIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handlePickFile}
        />
      </div>

      {menuOpen ? (
        <ProfileImageMenu
          hasCustomImage={hasCustomImage}
          pending={pending}
          onClose={() => setMenuOpen(false)}
          onPickFile={openImagePicker}
          onRevert={handleRevert}
        />
      ) : null}
    </>
  );
}

function CameraBadgeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}
