import { Type } from 'class-transformer';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  PlannerAddItemBodyDto,
  PlannerReorderItemsBodyDto,
  PlannerSwapRequestBodyDto,
  PlannerUpdateItemBodyDto,
} from '../../main-planner/dto/main-planner.dto';
import {
  ReplanLocationBodyDto,
  ReplanPlaceBodyDto,
  ReplanPreferencesBodyDto,
} from '../../replanning/dto/replan-request.dto';
import type { ReplanTrigger } from '@tripick/types';

const REPLAN_TRIGGERS = [
  'deviation',
  'weather',
  'crowd',
  'manual',
] as const satisfies readonly ReplanTrigger[];

/** replan payload — tripId 는 상위 proposal.tripId 로 강제되므로 제외 */
class ReplanProposalBodyDto {
  @IsIn(REPLAN_TRIGGERS)
  trigger!: ReplanTrigger;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReplanLocationBodyDto)
  currentLocation?: ReplanLocationBodyDto;

  @IsOptional()
  @IsString()
  deviatedItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ReplanPlaceBodyDto)
  mustIncludePlaces?: ReplanPlaceBodyDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ReplanPreferencesBodyDto)
  preferences?: ReplanPreferencesBodyDto;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

class AddItemPayloadDto {
  @IsIn(['add_item'])
  kind!: 'add_item';

  @ValidateNested()
  @Type(() => PlannerAddItemBodyDto)
  body!: PlannerAddItemBodyDto;
}

class UpdateItemPayloadDto {
  @IsIn(['update_item'])
  kind!: 'update_item';

  @IsUUID()
  itemId!: string;

  @ValidateNested()
  @Type(() => PlannerUpdateItemBodyDto)
  body!: PlannerUpdateItemBodyDto;
}

class DeleteItemPayloadDto {
  @IsIn(['delete_item'])
  kind!: 'delete_item';

  @IsUUID()
  itemId!: string;
}

class ReorderItemsPayloadDto {
  @IsIn(['reorder_items'])
  kind!: 'reorder_items';

  @ValidateNested()
  @Type(() => PlannerReorderItemsBodyDto)
  body!: PlannerReorderItemsBodyDto;
}

class SwapPayloadDto {
  @IsIn(['swap'])
  kind!: 'swap';

  @ValidateNested()
  @Type(() => PlannerSwapRequestBodyDto)
  body!: PlannerSwapRequestBodyDto;
}

class ReplanPayloadDto {
  @IsIn(['replan'])
  kind!: 'replan';

  @ValidateNested()
  @Type(() => ReplanProposalBodyDto)
  body!: ReplanProposalBodyDto;
}

export class CreateScheduleChangeBodyDto {
  @IsUUID()
  tripId!: string;

  @ValidateNested()
  @Type(() => Object, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'kind',
      subTypes: [
        { value: AddItemPayloadDto, name: 'add_item' },
        { value: UpdateItemPayloadDto, name: 'update_item' },
        { value: DeleteItemPayloadDto, name: 'delete_item' },
        { value: ReorderItemsPayloadDto, name: 'reorder_items' },
        { value: SwapPayloadDto, name: 'swap' },
        { value: ReplanPayloadDto, name: 'replan' },
      ],
    },
  })
  payload!:
    | AddItemPayloadDto
    | UpdateItemPayloadDto
    | DeleteItemPayloadDto
    | ReorderItemsPayloadDto
    | SwapPayloadDto
    | ReplanPayloadDto;
}
