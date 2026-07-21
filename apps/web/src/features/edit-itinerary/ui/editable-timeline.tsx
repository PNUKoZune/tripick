'use client';

import { useEffect, useState } from 'react';
import { LuGripVertical, LuPlus } from 'react-icons/lu';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { move } from '@dnd-kit/helpers';
import type { PlannerItineraryItemDto } from '@tripick/types';

import { ItineraryItemCard } from '@/entities/itinerary-item';
import { useItineraryItems } from '../model/use-itinerary-items';
import { ItemEditorSheet, type ItemEditorValues } from './item-editor-sheet';

type Props = {
  tripId: string;
  day: number;
  items: PlannerItineraryItemDto[];
  selectedItemId?: string | null;
  onSelectItem: (item: PlannerItineraryItemDto) => void;
  /** AI 대안 시트를 여는 콜백 */
  onSwitchItem?: (item: PlannerItineraryItemDto) => void;
  /** owner 면 즉시 반영, 아니면 owner 승인 대기 제안으로 보낸다 */
  isOwner?: boolean;
  /** 비-owner 제안 성공 시 요약 전달(토스트용) */
  onProposed?: (summary: string) => void;
};

type EditorState =
  | { mode: 'add' }
  | { mode: 'edit'; item: PlannerItineraryItemDto }
  | null;

export function EditableTimeline({
  tripId,
  day,
  items,
  selectedItemId = null,
  onSelectItem,
  onSwitchItem,
  isOwner = true,
  onProposed,
}: Props) {
  const { addItem, updateItem, deleteItem, reorderItems, isProposalMode } = useItineraryItems(
    tripId,
    { isOwner, ...(onProposed ? { onProposed } : {}) },
  );
  const [order, setOrder] = useState<string[]>(() => items.map((i) => i.id));
  const [editor, setEditor] = useState<EditorState>(null);
  const [confirmDelete, setConfirmDelete] = useState<PlannerItineraryItemDto | null>(null);

  // 서버 데이터가 바뀌면(추가/삭제/재정렬 반영 후) 로컬 순서를 동기화
  const itemsKey = items.map((i) => i.id).join(',');
  useEffect(() => {
    setOrder(items.map((i) => i.id));
  }, [itemsKey]);

  const byId = new Map(items.map((i) => [i.id, i]));
  const orderedItems = order
    .map((id) => byId.get(id))
    .filter((i): i is PlannerItineraryItemDto => Boolean(i));

  const editorPending = addItem.isPending || updateItem.isPending;
  const editorError =
    (editor?.mode === 'add' ? addItem.error : updateItem.error) instanceof Error
      ? ((editor?.mode === 'add' ? addItem.error : updateItem.error) as Error).message
      : null;

  function handleSubmit(values: ItemEditorValues) {
    if (editor?.mode === 'add') {
      addItem.mutate(
        {
          day,
          name: values.name,
          type: values.type,
          scheduledAt: values.scheduledAt,
          durationMin: values.durationMin,
          ...(values.address ? { address: values.address } : {}),
          ...(values.lat !== undefined ? { lat: values.lat } : {}),
          ...(values.lng !== undefined ? { lng: values.lng } : {}),
          ...(values.kakaoPlaceId ? { kakaoPlaceId: values.kakaoPlaceId } : {}),
          ...(values.memo ? { memo: values.memo } : {}),
        },
        { onSuccess: () => setEditor(null) },
      );
    } else if (editor?.mode === 'edit') {
      updateItem.mutate(
        {
          itemId: editor.item.id,
          body: {
            name: values.name,
            scheduledAt: values.scheduledAt,
            durationMin: values.durationMin,
            memo: values.memo,
          },
        },
        { onSuccess: () => setEditor(null) },
      );
    }
  }

  return (
    <div className="pb-4">
      {isProposalMode ? (
        <p className="mb-3 rounded-[12px] border border-[#C7DCFF] bg-[#F5F9FF] px-3 py-2 text-[12px] leading-[18px] text-[#1B64DA]">
          일정 변경은 여행 관리자 승인 후 반영돼요. 변경 요청을 보내면 관리자에게 알림이 전송됩니다.
        </p>
      ) : null}
      {orderedItems.length === 0 ? (
        <div className="rounded-[16px] border border-[#E5E8EB] bg-[#FAFBFC] p-5 text-center text-[14px] text-[#6B7684]">
          이 날짜에 등록된 일정이 없어요. 아래에서 추가해 보세요.
        </div>
      ) : (
        <>
        {orderedItems.length >= 2 ? (
          <p className="mb-2 flex items-center gap-1.5 rounded-[10px] bg-[#F2F4F6] px-2.5 py-1.5 text-[12px] font-medium text-[#6B7684]">
            <LuGripVertical className="size-3.5 shrink-0 text-[#8B95A1]" />
            왼쪽 손잡이를 잡고 끌어 순서를 바꿀 수 있어요
          </p>
        ) : null}
        <DragDropProvider
          onDragEnd={(event) => {
            const next = move(order, event);
            if (next.join(',') === order.join(',')) return;
            setOrder(next);
            reorderItems.mutate(
              { day, orderedItemIds: next },
              {
                // 제안 모드에선 아직 반영 전이므로 낙관적 재배치를 원상복구한다(승인돼야 적용)
                onSuccess: () => {
                  if (isProposalMode) setOrder(items.map((i) => i.id));
                },
                onError: () => setOrder(items.map((i) => i.id)),
              },
            );
          }}
        >
          <div className="space-y-2">
            {orderedItems.map((item, index) => (
              <SortableRow
                key={item.id}
                item={item}
                index={index}
                isLast={index === orderedItems.length - 1}
                selected={item.id === selectedItemId}
                onSelect={() => onSelectItem(item)}
                {...(onSwitchItem ? { onSwitch: () => onSwitchItem(item) } : {})}
                onEdit={() => setEditor({ mode: 'edit', item })}
                onDelete={() => setConfirmDelete(item)}
              />
            ))}
          </div>
        </DragDropProvider>
        </>
      )}

      <button
        type="button"
        onClick={() => setEditor({ mode: 'add' })}
        className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-[#C7DCFF] bg-[#F5F9FF] text-[14px] font-semibold text-[#3182F6] hover:bg-[#EAF2FF]"
      >
        <LuPlus className="size-4" />
        {isProposalMode ? '일정 추가 요청' : '일정 추가'}
      </button>

      <ItemEditorSheet
        open={editor !== null}
        mode={editor?.mode ?? 'add'}
        item={editor?.mode === 'edit' ? editor.item : null}
        pending={editorPending}
        error={editorError}
        {...(isProposalMode ? { submitLabel: '변경 요청' } : {})}
        onClose={() => setEditor(null)}
        onSubmit={handleSubmit}
      />

      {confirmDelete ? (
        <DeleteConfirm
          name={confirmDelete.name}
          pending={deleteItem.isPending}
          proposalMode={isProposalMode}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() =>
            deleteItem.mutate(confirmDelete.id, { onSuccess: () => setConfirmDelete(null) })
          }
        />
      ) : null}
    </div>
  );
}

function SortableRow({
  item,
  index,
  isLast,
  selected,
  onSelect,
  onSwitch,
  onEdit,
  onDelete,
}: {
  item: PlannerItineraryItemDto;
  index: number;
  isLast: boolean;
  selected: boolean;
  onSelect: () => void;
  onSwitch?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { ref, handleRef, isDragging } = useSortable({ id: item.id, index });
  return (
    <div ref={ref}>
      <ItineraryItemCard
        item={item}
        isLast={isLast}
        selected={selected}
        dragging={isDragging}
        dragHandleRef={handleRef}
        onClick={onSelect}
        {...(onSwitch ? { onSwitch } : {})}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}

function DeleteConfirm({
  name,
  pending,
  proposalMode = false,
  onCancel,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  proposalMode?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5"
    >
      <div className="w-full max-w-[360px] rounded-[20px] bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
        <h2 className="text-[17px] font-bold text-[#191F28]">
          {proposalMode ? '이 일정 삭제를 요청할까요?' : '이 일정을 삭제할까요?'}
        </h2>
        <p className="mt-2 text-[13px] leading-[20px] text-[#4E5968]">
          {proposalMode
            ? `“${name}” 삭제 요청을 여행 관리자에게 보냅니다.`
            : `“${name}” 항목이 일정에서 제거됩니다.`}
        </p>
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-11 flex-1 rounded-[12px] border border-[#E5E8EB] bg-white text-[14px] font-bold text-[#6B7684] hover:bg-[#FAFBFC] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="h-11 flex-1 rounded-[12px] bg-[#F04452] text-[14px] font-bold text-white hover:bg-[#D93645] disabled:opacity-50"
          >
            {pending ? '처리 중…' : proposalMode ? '삭제 요청' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  );
}
