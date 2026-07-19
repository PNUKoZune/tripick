import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ALL_TASTE_TAGS,
  ENVIRONMENT_PREFERENCES,
  FOOD_PREFERENCES,
  MOOD_PREFERENCES,
  type ActivityIntensity,
  type CrowdPreference,
  type EnvironmentPreference,
  type FoodPreference,
  type MoodPreference,
  type PreferenceProfileDto,
  type TasteTagDto,
  type TasteTagValue,
  type ThemePreference,
  type TogglePhotoTagDto,
  type TransportPreference,
  type TravelPace,
  type UpdatePreferenceDto,
} from '@tripick/types';
import { HH_MM } from '../../common/validation/patterns';

// 어휘는 @tripick/types 가 정본 — 여기에 다시 적으면 어휘를 늘릴 때 조용히 뒤처진다.
const FOOD = FOOD_PREFERENCES;
const MOOD = MOOD_PREFERENCES;
const ENVIRONMENT = ENVIRONMENT_PREFERENCES;

const TRANSPORT = [
  'transit',
  'walk',
  'car',
  'rental_car',
] as const satisfies readonly TransportPreference[];

const THEMES = [
  'mountain_forest',
  'beach',
  'lake_river',
  'park_garden',
  'exhibition',
  'heritage',
  'performance',
  'museum',
  'local_food',
  'cafe_dessert',
  'bar',
  'market_street',
  'sports',
  'themepark',
  'class',
  'wellness',
  'select_shop',
  'mall',
  'local_street',
  'nightview',
  'photo_spot',
  'unique_space',
] as const satisfies readonly ThemePreference[];

const PACE = ['packed', 'balanced', 'relaxed'] as const satisfies readonly TravelPace[];
const INTENSITY = ['active', 'moderate', 'restful'] as const satisfies readonly ActivityIntensity[];
const CROWD = ['hotspot', 'balanced', 'quiet'] as const satisfies readonly CrowdPreference[];

/** 취향 사진 URL 개수 상한 — 온보딩에서 올리는 장 수를 넉넉히 덮는다. */
const MAX_PHOTO_URLS = 30;

export class TasteTagBodyDto implements Partial<TasteTagDto> {
  @IsOptional()
  @IsArray()
  @IsIn(FOOD, { each: true })
  food?: FoodPreference[];

  @IsOptional()
  @IsArray()
  @IsIn(MOOD, { each: true })
  mood?: MoodPreference[];

  @IsOptional()
  @IsArray()
  @IsIn(ENVIRONMENT, { each: true })
  environment?: EnvironmentPreference[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class PreferenceProfileBodyDto implements Partial<PreferenceProfileDto> {
  @IsOptional()
  @Matches(HH_MM)
  sleepTime?: string;

  @IsOptional()
  @Matches(HH_MM)
  wakeTime?: string;

  @IsOptional()
  @IsArray()
  @IsIn(TRANSPORT, { each: true })
  transportModes?: TransportPreference[];

  @IsOptional()
  @IsArray()
  @IsIn(THEMES, { each: true })
  likedThemes?: ThemePreference[];

  @IsOptional()
  @IsArray()
  @IsIn(THEMES, { each: true })
  dislikedThemes?: ThemePreference[];

  @IsOptional()
  @IsIn(PACE)
  pace?: TravelPace;

  @IsOptional()
  @IsIn(INTENSITY)
  activityIntensity?: ActivityIntensity;

  @IsOptional()
  @IsIn(CROWD)
  crowdPreference?: CrowdPreference;
}

export class UpdatePreferenceBodyDto implements UpdatePreferenceDto {
  @ValidateNested()
  @Type(() => TasteTagBodyDto)
  tasteTags!: TasteTagBodyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PreferenceProfileBodyDto)
  profile?: PreferenceProfileBodyDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PHOTO_URLS)
  @IsString({ each: true })
  @IsUrl({ require_tld: false }, { each: true })
  photoUrls?: string[];
}

export class TogglePhotoTagBodyDto implements TogglePhotoTagDto {
  @IsString()
  @IsUrl({ require_tld: false })
  url!: string;

  @IsIn(ALL_TASTE_TAGS)
  tag!: TasteTagValue;

  @IsBoolean()
  enabled!: boolean;
}
