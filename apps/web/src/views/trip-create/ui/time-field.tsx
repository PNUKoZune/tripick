'use client';

import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { renderTimeViewClock } from '@mui/x-date-pickers/timeViewRenderers';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ko } from 'date-fns/locale';

type Props = {
  label: string;
  value: string;
  onChange: (next: string) => void;
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

/** MUI TimePicker(아날로그 TimeClock 팝업)로 시각 선택 (HH:mm). */
export function TimeField({ label, value, onChange }: Props) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-[#6B7684]">{label}</span>
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
                sx: {
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
                  '&:hover .MuiOutlinedInput-root:not(.Mui-focused) .MuiOutlinedInput-notchedOutline':
                    { borderColor: '#E5E8EB' },
                  '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#3182F6',
                    borderWidth: '1px',
                  },
                  '& .MuiInputAdornment-root': { marginLeft: 0 },
                  '& .MuiIconButton-root': { color: '#8B95A1', padding: '6px' },
                  '& .MuiSvgIcon-root': { fontSize: 20 },
                },
              },
            }}
          />
        </LocalizationProvider>
      </ThemeProvider>
    </label>
  );
}
