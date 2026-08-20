import type { IconType } from 'react-icons';
import { LuBus, LuCoffee, LuMapPin, LuUtensils } from 'react-icons/lu';
import type { PlannerItemType } from '@tripick/types';

/**
 * 일정 카테고리 → 아이콘 SSOT. 카테고리를 그림으로 보여주는 곳(공유 카드·대안 카드 등)이
 * 각자 이모지를 들고 있으면 화면마다 다른 그림이 나오고, 이모지는 OS·폰트마다 모양과
 * 크기가 달라 캡처(html-to-image) 결과도 기기별로 갈린다. 아이콘 컴포넌트로 통일한다.
 * 서버가 내려주는 `categoryEmoji` 대신 같은 DTO 의 `category`(=PlannerItemType)로 고른다.
 */
export const ITEM_TYPE_ICON: Record<PlannerItemType, IconType> = {
  attraction: LuMapPin,
  restaurant: LuUtensils,
  cafe: LuCoffee,
  transport: LuBus,
};

export function ItemTypeIcon({
  type,
  className = '',
}: {
  type: PlannerItemType;
  className?: string;
}) {
  const Icon = ITEM_TYPE_ICON[type];
  return <Icon className={className} aria-hidden />;
}
