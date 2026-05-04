import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { TasteTagDto } from '@tripick/types';

/**
 * Vision Preference Analyzer
 *
 * 이미지(직접 업로드 or Instagram) → Taste Tag 추출
 * MVP: Local LLM (vision 모델) 또는 Triton Inference Server 사용
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

  async analyzeImage(imageUrl: string): Promise<TasteTagDto> {
    const baseUrl = this.config.get<string>('LLM_BASE_URL', 'http://localhost:8080/v1');
    const apiKey = this.config.get<string>('LLM_API_KEY', 'local');

    try {
      const res = await axios.post<{
        choices: Array<{ message: { content: string } }>;
      }>(
        `${baseUrl}/chat/completions`,
        {
          model: this.config.get('LLM_MODEL', 'gemma-4'),
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: imageUrl },
                },
                {
                  type: 'text',
                  text: `이 이미지를 분석하여 다음 JSON 형식으로 취향 태그를 추출해주세요:
{
  "food": ["korean"|"japanese"|"western"|"chinese"|"vegan"|"cafe"],
  "mood": ["healing"|"adventure"|"romantic"|"family"|"cultural"],
  "environment": ["nature"|"city"|"beach"|"mountain"|"village"],
  "confidence": 0.0~1.0
}
이미지와 관련 없는 카테고리 배열은 비워두세요.`,
                },
              ],
            },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      const content = res.data.choices[0]?.message.content ?? '{}';
      return JSON.parse(content) as TasteTagDto;
    } catch (err) {
      this.logger.error('Vision 분석 실패:', err);
      return { food: [], mood: [], environment: [], confidence: 0 };
    }
  }

  async analyzeMultiple(imageUrls: string[]): Promise<TasteTagDto> {
    const results = await Promise.all(imageUrls.map((url) => this.analyzeImage(url)));

    // 여러 이미지 태그 집계 (빈도 기반)
    const foodCount = new Map<string, number>();
    const moodCount = new Map<string, number>();
    const envCount = new Map<string, number>();
    let totalConfidence = 0;

    for (const r of results) {
      r.food.forEach((t) => foodCount.set(t, (foodCount.get(t) ?? 0) + 1));
      r.mood.forEach((t) => moodCount.set(t, (moodCount.get(t) ?? 0) + 1));
      r.environment.forEach((t) => envCount.set(t, (envCount.get(t) ?? 0) + 1));
      totalConfidence += r.confidence;
    }

    const threshold = Math.ceil(results.length / 2);
    return {
      food: [...foodCount.entries()].filter(([, c]) => c >= threshold).map(([t]) => t) as any,
      mood: [...moodCount.entries()].filter(([, c]) => c >= threshold).map(([t]) => t) as any,
      environment: [...envCount.entries()].filter(([, c]) => c >= threshold).map(([t]) => t) as any,
      confidence: results.length > 0 ? totalConfidence / results.length : 0,
    };
  }
}
