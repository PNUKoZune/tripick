'use client';

import type { SxProps, Theme } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { renderTimeViewClock } from '@mui/x-date-pickers/timeViewRenderers';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ko } from 'date-fns/locale';

type Variant = 'outlined' | 'soft';

type Props = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  /** 'outlined'(기본, 여행 생성 폼) / 'soft'(취향 설정 - soft-bg 박스, 굵은 큰 글씨) */
  variant?: Variant;
};

/** 페이지 폰트를 그대로 쓰고, 브랜드 컬러(#3182F6)를 시계 팝업 선택 색으로 쓰기 위한 최소 테마 */
const theme = createTheme({
  palette: { primary: { main: '#3182F6' } },
  typography: { fontFamily: 'inherit' },
});

function toDate(value: string): Date | null {
  const [hRaw, mRaw] = value.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date;
}

function toTimeString(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * 입력 글자색만 페이지 토큰으로 되돌린다. 라이트에선 기존 색(#191F28)과 같은 값이고,
 * 다크(.wvr-scope)에선 --text-primary 가 밝은 값으로 섀도잉돼 글자가 보인다.
 * `-webkit-text-fill-color` 까지 같이 줘야 WebKit 계열에서 검정이 남지 않는다.
 */
const pickersInputColorSx = {
  '& .MuiPickersInputBase-input': {
    color: 'var(--text-primary)',
    WebkitTextFillColor: 'var(--text-primary)',
  },
} as const;

/** 여행 생성 폼: 흰 배경 아웃라인 인풋 */
const outlinedSx: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    height: 48,
    borderRadius: '14px',
    backgroundColor: '#fff',
    paddingRight: '10px',
    fontFamily: 'inherit',
    fontSize: '15px',
    fontWeight: 500,
    color: '#191F28',
    '&.Mui-focused': { boxShadow: '0 0 0 2px #E1ECFF' },
  },
  '& .MuiOutlinedInput-input': {
    height: '100%',
    padding: '0 4px 0 16px',
    boxSizing: 'border-box',
  },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E8EB' },
  '&:hover .MuiOutlinedInput-root:not(.Mui-focused) .MuiOutlinedInput-notchedOutline': {
    borderColor: '#E5E8EB',
  },
  '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: '#3182F6',
    borderWidth: '1px',
  },
  '& .MuiInputAdornment-root': { marginLeft: 0 },
  '& .MuiIconButton-root': { color: '#8B95A1', padding: '6px' },
  '& .MuiSvgIcon-root': { fontSize: 20 },
  // MUI X v7 TimePicker 의 입력부는 OutlinedInput 이 아니라 PickersInputBase 다 —
  // 위 .MuiOutlinedInput-* 선택자가 안 걸려 글자색이 MUI 기본값(rgba(0,0,0,.87))으로 남는다.
  ...pickersInputColorSx,
};

/** 취향 설정: soft-bg 박스 안에서 테두리 없이 굵은 큰 글씨 */
const softSx: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    height: 28,
    paddingRight: 0,
    fontFamily: 'inherit',
    fontSize: '20px',
    fontWeight: 900,
    lineHeight: '28px',
    color: 'var(--text-primary)',
  },
  '& .MuiOutlinedInput-input': {
    height: '100%',
    padding: 0,
    boxSizing: 'border-box',
  },
  '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
  '&:hover .MuiOutlinedInput-notchedOutline': { border: 'none' },
  '& .Mui-focused .MuiOutlinedInput-notchedOutline': { border: 'none' },
  '& .MuiInputAdornment-root': { marginLeft: 0 },
  '& .MuiIconButton-root': { color: 'var(--text-tertiary)', padding: '4px' },
  '& .MuiSvgIcon-root': { fontSize: 18 },
  ...pickersInputColorSx,
  // soft 변형은 박스 안에 테두리 없이 놓이는 의도 — Pickers 쪽 노치 테두리도 함께 지운다.
  '& .MuiPickersOutlinedInput-notchedOutline': { border: 'none' },
};

/** MUI TimePicker(아날로그 TimeClock 팝업)로 시각 선택 (HH:mm). */
export function TimeField({ label, value, onChange, variant = 'outlined' }: Props) {
  const isSoft = variant === 'soft';

  return (
    <label
      className={
        isSoft
          ? 'flex flex-col gap-1 rounded-[16px] bg-[color:var(--soft-bg)] px-4 py-3'
          : 'flex flex-col gap-1'
      }
    >
      <span
        className={
          isSoft
            ? 'text-[13px] font-bold text-[color:var(--text-tertiary)]'
            : 'text-[12px] font-semibold text-[#6B7684]'
        }
      >
        {label}
      </span>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ko}>
          <TimePicker
            value={toDate(value)}
            onChange={(next) => {
              const parsed = toTimeString(next);
              if (parsed) onChange(parsed);
            }}
            ampm={false}
            viewRenderers={{
              hours: renderTimeViewClock,
              minutes: renderTimeViewClock,
            }}
            slotProps={{
              textField: {
                fullWidth: true,
                sx: isSoft ? softSx : outlinedSx,
              },
            }}
          />
        </LocalizationProvider>
      </ThemeProvider>
    </label>
  );
}
