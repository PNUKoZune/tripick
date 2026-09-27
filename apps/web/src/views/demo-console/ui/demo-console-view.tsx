'use client';

import { useState } from 'react';
import {
  LuCalendarPlus,
  LuCloudRain,
  LuLoaderCircle,
  LuMapPin,
  LuRotateCcw,
  LuUsers,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import type { DemoScenario } from '@tripick/types';

import { SessionGuard } from '@/entities/session';
import { useDemoConsole } from '@/features/run-demo-scenario';
import { SurfaceCard } from '@/shared/ui';
import { AppFrame, PageContainer, PageHeader } from '@/shared/ui/app-frame';

/** 시나리오 버튼 정의 — 무대에서 읽는 문구라 "무엇을 주입하는지"를 그대로 적는다. */
const SCENARIOS: Array<{
  key: DemoScenario;
  label: string;
  hint: string;
  Icon: IconType;
  tone: string;
}> = [
  {
    key: 'arrival',
    label: '미도착 조건 주입',
    hint: '일정 시각 도래 + 현재 위치를 장소 밖으로',
    Icon: LuMapPin,
    tone: 'var(--danger)',
  },
  {
    key: 'weather',
    label: '강수 예보 주입',
    hint: '대상 일차에 비 예보',
    Icon: LuCloudRain,
    tone: 'var(--accent-deep)',
  },
  {
    key: 'crowd',
    label: '혼잡 예측 주입',
    hint: '대상 일차 관광지 집중률 상승',
    Icon: LuUsers,
    tone: 'var(--accent-deep)',
  },
];

/** 실행 결과 한 줄 — 성공·실패 모두 같은 자리에 쌓아 무대에서 눈이 한 곳만 보게 한다. */
type LogLine = { at: string; text: string; ok: boolean };

/**
 * 시연 콘솔 화면 (발표 보조 도구).
 *
 * 알림을 만들어 내는 화면이 아니라 **조건을 주입하고 실제 스캐너를 즉시 돌리는** 화면이다.
 * 버튼을 누르면 서버가 위치·예보·집중률만 넣고 운영 알림 경로를 그대로 태우며, 결과 줄에는
 * 실제로 발송된 알림 건수가 그대로 찍힌다(판정에서 걸러지면 0건으로 보인다).
 *
 * 링크를 어디에도 걸지 않는다 — 서버 플래그(`DEMO_CONSOLE_ENABLED`)로 열고 주소를 아는
 * 발표자만 들어온다.
 */
export function DemoConsoleView() {
  const { status, seed, scenario, reset, selection } = useDemoConsole();
  const [log, setLog] = useState<LogLine[]>([]);

  const append = (text: string, ok: boolean) => {
    const at = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    setLog((prev) => [{ at, text, ok }, ...prev].slice(0, 8));
  };

  const busy = seed.isPending || scenario.isPending || reset.isPending;
  const trip = status.data?.trip ?? null;
  const trips = status.data?.trips ?? [];
  const selected = trips.find((option) => option.tripId === trip?.tripId) ?? null;
  const location = status.data?.location ?? null;
  const unavailable = status.isError;

  const run = (name: DemoScenario) => {
    scenario.mutate(name, {
      onSuccess: (result) => append(result.detail, result.alerted > 0),
      onError: (error) => append(error.message, false),
    });
  };

  return (
    <SessionGuard>
      <AppFrame>
        <PageHeader
          title="시연 콘솔"
          label="Demo"
          description="조건만 주입하고 판정·발송은 실제 알림 경로가 처리합니다."
        />
        <PageContainer className="flex flex-col gap-3">
          {unavailable ? (
            <SurfaceCard padding="sm">
              <p className="text-[14px] font-bold text-[color:var(--danger)]">
                시연 콘솔이 꺼져 있습니다
              </p>
              <p className="mt-1 text-[13px] text-[color:var(--text-secondary)]">
                서버에 DEMO_CONSOLE_ENABLED=true 와 DEMO_CONSOLE_EMAILS(발표 계정) 를 설정한 뒤
                다시 여세요. ({status.error?.message})
              </p>
            </SurfaceCard>
          ) : null}

          <SurfaceCard padding="sm">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14px] font-bold text-[color:var(--text-primary)]">대상 여행</p>
              {status.isFetching ? (
                <LuLoaderCircle className="animate-spin text-[color:var(--text-secondary)]" />
              ) : null}
            </div>

            <div className="mt-2 flex gap-2">
              <select
                aria-label="대상 여행"
                value={trip?.tripId ?? ''}
                onChange={(event) => {
                  selection.setTripId(event.target.value || null);
                  // 여행마다 일차 수가 다르므로 선택을 비워 서버 기본값(오늘 일차)으로 되돌린다.
                  selection.setDay(null);
                }}
                className="min-w-0 flex-1 rounded-[10px] border border-[color:var(--line-strong)] bg-[color:var(--app-surface)] px-2 py-2 text-[13px] text-[color:var(--text-primary)]"
              >
                {trips.length === 0 ? <option value="">여행 없음</option> : null}
                {trips.map((option) => (
                  <option key={option.tripId} value={option.tripId}>
                    {option.seeded ? '[시드] ' : ''}
                    {option.title} ({option.startDate})
                    {option.scannable ? '' : ` · ${option.status}`}
                  </option>
                ))}
              </select>
              <select
                aria-label="대상 일차"
                value={trip?.day ?? 1}
                onChange={(event) => selection.setDay(Number(event.target.value))}
                className="shrink-0 rounded-[10px] border border-[color:var(--line-strong)] bg-[color:var(--app-surface)] px-2 py-2 text-[13px] text-[color:var(--text-primary)]"
              >
                {Array.from({ length: selected?.days ?? trip?.day ?? 1 }, (_, index) => index + 1).map(
                  (value) => (
                    <option key={value} value={value}>
                      {value}일차
                    </option>
                  ),
                )}
              </select>
            </div>

            {selected && !selected.scannable ? (
              <p className="mt-2 text-[12px] text-[color:var(--danger)]">
                상태가 {selected.status} 라 알림 스캐너가 보지 않습니다 — 일정을 생성·확정한 여행을
                고르세요.
              </p>
            ) : null}

            {trip ? (
              <>
                <p className="mt-2 text-[13px] text-[color:var(--text-secondary)]">
                  {trip.date} · {trip.items.length}개 일정
                </p>
                <ul className="mt-3 flex flex-col gap-1">
                  {trip.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 text-[13px]"
                    >
                      <span className="truncate text-[color:var(--text-primary)]">
                        <span className="tabular-nums text-[color:var(--text-secondary)]">
                          {item.time}
                        </span>{' '}
                        {item.name}
                      </span>
                      {item.arrivalDue ? (
                        <span className="shrink-0 rounded-[8px] bg-[color:var(--danger-tint)] px-2 py-0.5 text-[11px] font-bold text-[color:var(--danger)]">
                          판정 창
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-[13px] text-[color:var(--text-secondary)]">
                시연 대상 여행이 없습니다. 아래에서 시드하거나 직접 여행을 만드세요.
              </p>
            )}

            <p className="mt-3 text-[12px] text-[color:var(--text-secondary)]">
              서버 보관 위치:{' '}
              {location
                ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)} · ${location.ageSec}초 전 ${
                    location.fresh ? '(판정 가능)' : '(오래됨)'
                  }`
                : '없음'}
            </p>
          </SurfaceCard>

          <SurfaceCard padding="sm">
            <p className="text-[14px] font-bold text-[color:var(--text-primary)]">실행 결과</p>
            {log.length === 0 ? (
              <p className="mt-1 text-[13px] text-[color:var(--text-secondary)]">
                아직 실행한 시나리오가 없습니다.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {log.map((line, index) => (
                  <li key={`${line.at}-${index}`} className="text-[13px] leading-[20px]">
                    <span className="tabular-nums text-[color:var(--text-secondary)]">
                      {line.at}
                    </span>{' '}
                    <span
                      className={
                        line.ok
                          ? 'text-[color:var(--text-primary)]'
                          : 'text-[color:var(--danger)]'
                      }
                    >
                      {line.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SurfaceCard>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              seed.mutate(undefined, {
                onSuccess: (result) =>
                  append(`시연용 여행 시드 완료 — ${result.title} (${result.date})`, true),
                onError: (error) => append(error.message, false),
              })
            }
            className="flex items-center gap-3 rounded-[12px] border border-[color:var(--line-strong)] bg-[color:var(--app-surface)] p-4 text-left disabled:opacity-50"
          >
            <LuCalendarPlus size={20} color="var(--ok)" />
            <span className="min-w-0">
              <span className="block text-[15px] font-bold text-[color:var(--text-primary)]">
                시연용 여행 시드
              </span>
              <span className="block text-[12px] text-[color:var(--text-secondary)]">
                오늘 당일 일정 6개 · 지금 시각 기준으로 배치
              </span>
            </span>
          </button>

          {SCENARIOS.map(({ key, label, hint, Icon, tone }) => (
            <button
              key={key}
              type="button"
              disabled={busy}
              onClick={() => run(key)}
              className="flex items-center gap-3 rounded-[12px] border border-[color:var(--line-strong)] bg-[color:var(--app-surface)] p-4 text-left disabled:opacity-50"
            >
              <Icon size={20} color={tone} />
              <span className="min-w-0">
                <span className="block text-[15px] font-bold text-[color:var(--text-primary)]">
                  {label}
                </span>
                <span className="block text-[12px] text-[color:var(--text-secondary)]">{hint}</span>
              </span>
            </button>
          ))}

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              reset.mutate(undefined, {
                onSuccess: () => append('초기화 완료 — 주입 위치·중복 억제 키 삭제', true),
                onError: (error) => append(error.message, false),
              })
            }
            className="flex items-center gap-3 rounded-[12px] border border-[color:var(--line-strong)] p-4 text-left disabled:opacity-50"
          >
            <LuRotateCcw size={20} color="var(--text-secondary)" />
            <span className="min-w-0">
              <span className="block text-[15px] font-bold text-[color:var(--text-primary)]">
                리허설 흔적 정리 (초기화)
              </span>
              <span className="block text-[12px] text-[color:var(--text-secondary)]">
                주입한 위치와 알림 발송 기록을 지웁니다
              </span>
            </span>
          </button>

        </PageContainer>
      </AppFrame>
    </SessionGuard>
  );
}
