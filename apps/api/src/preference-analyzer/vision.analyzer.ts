import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type {
  EnvironmentPreference,
  FoodPreference,
  MoodPreference,
  TasteTagDto,
} from '@tripick/types';

const FOOD_TAGS: readonly FoodPreference[] = [
  'korean',
  'japanese',
  'western',
  'chinese',
  'vegan',
  'cafe',
];
const MOOD_TAGS: readonly MoodPreference[] = [
  'healing',
  'adventure',
  'romantic',
  'family',
  'cultural',
];
const ENVIRONMENT_TAGS: readonly EnvironmentPreference[] = [
  'nature',
  'city',
  'beach',
  'mountain',
  'village',
];

/** 카테고리당 채택할 최대 태그 수. 너무 많으면 프롬프트 주입 시 취향 신호가 흐려진다. */
const MAX_TAGS_PER_CATEGORY = 3;

const EMPTY_TAGS: TasteTagDto = { food: [], mood: [], environment: [], confidence: 0 };

/**
 * 분석 결과 + 성공 여부.
 *
 * "분석은 됐는데 뚜렷한 취향이 없음"과 "호출이 실패함"은 둘 다 빈 태그로 보이지만
 * 후자는 재시도해야 한다. 호출자가 구분할 수 있도록 ok 를 함께 돌려준다.
 */
export interface VisionResult {
  tags: TasteTagDto;
  ok: boolean;
}

/**
 * Vision Preference Analyzer
 *
 * 사용자가 직접 올린 사진 → 여행 취향 태그(Taste Tag) 추출.
 * 로컬 Gemma(llama.cpp + mmproj) 의 OpenAI 호환 chat/completions 에 data URL 이미지를 실어 보낸다.
 *
 * 분류:
 * - Food: korean, japanese, western, chinese, vegan, cafe
 * - Mood: healing, adventure, romantic, family, cultural
 * - Environment: nature, city, beach, mountain, village
 */
@Injectable()
export class VisionAnalyzer {
  private readonly logger = new Logger(VisionAnalyzer.name);

  constructor(private readonly config: ConfigService) {}

  /** 사진 한 장을 분석한다. 여러 장은 호출자(분석 잡)가 순차로 돌린다. */
  async analyzePhoto(imageUrl: string): Promise<VisionResult> {
    // vision 전용 서버를 따로 띄운 경우에만 분리, 기본은 플래너와 같은 LLM 서버(mmproj 로드됨)
    const baseUrl = this.config.get<string>(
      'LLM_VISION_BASE_URL',
      this.config.get<string>('LLM_BASE_URL', 'http://localhost:8080/v1'),
    );
    const apiKey = this.config.get<string>('LLM_API_KEY', 'local');
    const model = this.config.get<string>(
      'LLM_VISION_MODEL',
      this.config.get<string>('LLM_MODEL', 'gemma-4'),
    );
    // 이미지 프리필 때문에 텍스트 추론보다 훨씬 느리다.
    // 로컬 Gemma 4 26B(Q4_K_M) 실측: 콜드 첫 장 ~53s, 웜 ~35s. 콜드를 못 버티면 첫 업로드가 통째로 실패한다.
    const timeout = this.readNumber('LLM_VISION_TIMEOUT_MS', 90000);

    try {
      const res = await axios.post<{
        choices: Array<{ message: { content: string } }>;
      }>(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are TriPick Preference Analyzer. Infer the travel taste of the person who saved this photo. Answer with strict JSON only, no prose, no markdown fences.',
            },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: imageUrl } },
                { type: 'text', text: this.buildPrompt() },
              ],
            },
          ],
          temperature: this.readNumber('LLM_VISION_TEMPERATURE', 0.1),
          response_format: { type: 'json_object' },
        },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout },
      );

      const content = res.data.choices[0]?.message.content ?? '';
      // 응답은 받았으니 성공 — 태그가 비어도 "이 사진엔 뚜렷한 취향이 없다"는 유효한 결론이다.
      return { tags: this.parseTasteTags(content), ok: true };
    } catch (err) {
      this.logger.error(
        `Vision 분석 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { tags: { ...EMPTY_TAGS }, ok: false };
    }
  }

  /**
   * 사진별 분석 결과를 하나의 취향 태그로 합친다.
   * 사진을 추가·삭제할 때 이미 분석해 둔 결과로 다시 부를 수 있도록 분석과 분리해 둔다.
   */
  aggregate(results: TasteTagDto[]): TasteTagDto {
    // 태그가 하나도 안 나온 결과(실패·판별 불가)는 빈도·신뢰도 집계에서 제외한다.
    const contributing = results.filter(
      (r) => r.food.length + r.mood.length + r.environment.length > 0,
    );
    if (contributing.length === 0) return { ...EMPTY_TAGS };

    const threshold = this.agreementThreshold(contributing.length);
    const confidence =
      contributing.reduce((sum, r) => sum + r.confidence, 0) / contributing.length;

    return {
      food: this.topTags(contributing.flatMap((r) => r.food), threshold),
      mood: this.topTags(contributing.flatMap((r) => r.mood), threshold),
      environment: this.topTags(contributing.flatMap((r) => r.environment), threshold),
      confidence: this.clampConfidence(confidence),
    };
  }

  private buildPrompt(): string {
    return [
      '이 사진을 보고, 이런 사진을 저장하는 사람의 국내 여행 취향을 추론해줘.',
      '사진에 찍힌 사물을 나열하지 말고, 어떤 여행지를 좋아할 사람인지로 판단해.',
      '',
      '아래 값들 중에서만 고르고, 해당 없으면 빈 배열로 둬.',
      `food: ${FOOD_TAGS.join(' | ')}`,
      `mood: ${MOOD_TAGS.join(' | ')}`,
      `environment: ${ENVIRONMENT_TAGS.join(' | ')}`,
      '',
      'confidence 는 이 사진만으로 취향을 판단한 확신도(0.0~1.0).',
      // 상수와 어긋나면 상수를 올려도 모델이 안 따라온다 — 한 곳에서만 정한다.
      `카테고리당 최대 ${MAX_TAGS_PER_CATEGORY}개까지만. 애매하면 넣지 말 것.`,
      '',
      'JSON 형식:',
      '{"food":[],"mood":[],"environment":[],"confidence":0.0}',
    ].join('\n');
  }

  /**
   * 모델 응답에서 취향 태그를 뽑아낸다.
   * llama.cpp 는 response_format 을 줘도 코드펜스나 짧은 서두를 붙일 때가 있어
   * 바깥쪽 중괄호 구간만 잘라 쓰고, 정해진 값에 없는 태그는 버린다.
   */
  private parseTasteTags(content: string): TasteTagDto {
    const json = this.extractJsonObject(content);
    if (!json) {
      this.logger.warn(`Vision 응답에서 JSON 을 찾지 못함: ${content.slice(0, 120)}`);
      return { ...EMPTY_TAGS };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json) as Record<string, unknown>;
    } catch {
      this.logger.warn(`Vision 응답 JSON 파싱 실패: ${json.slice(0, 120)}`);
      return { ...EMPTY_TAGS };
    }

    const food = this.pickAllowed(parsed.food, FOOD_TAGS);
    const mood = this.pickAllowed(parsed.mood, MOOD_TAGS);
    const environment = this.pickAllowed(parsed.environment, ENVIRONMENT_TAGS);
    // 태그가 하나도 없으면 신뢰도는 의미가 없다.
    const hasTag = food.length + mood.length + environment.length > 0;

    return {
      food,
      mood,
      environment,
      confidence: hasTag ? this.clampConfidence(Number(parsed.confidence)) : 0,
    };
  }

  /**
   * 첫 '{' 부터 마지막 '}' 까지를 잘라낸다.
   * 서두·코드펜스는 이걸로 걷히고, 그래도 깨진 JSON 이면 호출부의 파싱 실패로 걸러진다.
   */
  private extractJsonObject(content: string): string | null {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    return content.slice(start, end + 1);
  }

  /** 허용된 값만 남기고 소문자·공백을 정규화한다. 중복은 제거. */
  private pickAllowed<T extends string>(value: unknown, allowed: readonly T[]): T[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<T>();
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const normalized = item.trim().toLowerCase();
      const match = allowed.find((tag) => tag === normalized);
      if (match) seen.add(match);
    }
    return [...seen];
  }

  /**
   * 여러 장에서 공통으로 나온 태그만 채택하기 위한 최소 등장 횟수.
   * 사진이 많을수록 취향이 갈리므로 과반이 아니라 비율(30%)로 본다.
   */
  private agreementThreshold(count: number): number {
    if (count <= 2) return 1;
    return Math.max(2, Math.ceil(count * 0.3));
  }

  /** 등장 횟수가 threshold 이상인 태그를 빈도순으로 상위 N개만 반환. */
  private topTags<T extends string>(tags: T[], threshold: number): T[] {
    const count = new Map<T, number>();
    for (const tag of tags) count.set(tag, (count.get(tag) ?? 0) + 1);
    return [...count.entries()]
      .filter(([, c]) => c >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TAGS_PER_CATEGORY)
      .map(([tag]) => tag);
  }

  private clampConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  private readNumber(key: string, fallback: number): number {
    const parsed = Number(this.config.get<string | number>(key, fallback));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
