import { useMemo, useState } from 'react';
import { addDays, daysBetween } from '../lib/api.js';
import { BackIcon, ChevronIcon } from './Icons.jsx';

const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const inRanges = (d, ranges) => ranges.find((r) => d >= r.start && d <= r.end);

/**
 * cal: { today, booked:[{start,end,mine}], pending:[...], max_days }
 * select: if set, user can pick a range → onSelect({start, end})
 */
export default function AvailabilityCalendar({ cal, select = false, value, onSelect, maxDays }) {
  const today = cal.today;
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [hover, setHover] = useState(null);
  const limit = maxDays || cal.max_days || 60;

  const days = useMemo(() => {
    const first = `${month}-01`;
    const dow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday first
    const start = addDays(first, -dow);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);

  const shift = (n) => {
    const d = new Date(month + '-01T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const lastMonth = addDays(today, 90).slice(0, 7);

  const blocked = (d) => d < today || !!inRanges(d, cal.booked) || d > addDays(today, 90);
  const rangeOk = (s, e) => {
    if (daysBetween(s, e) + 1 > limit) return false;
    for (let d = s; d <= e; d = addDays(d, 1)) if (blocked(d)) return false;
    return true;
  };

  const click = (d) => {
    if (!select || blocked(d)) return;
    if (!value?.start || value.end) { onSelect({ start: d, end: null }); return; }
    if (d < value.start) { onSelect({ start: d, end: null }); return; }
    if (!rangeOk(value.start, d)) { onSelect({ start: d, end: null }); return; }
    onSelect({ start: value.start, end: d });
  };

  const selEnd = value?.end || (value?.start && hover && hover >= value.start && rangeOk(value.start, hover) ? hover : null);
  const label = new Date(month + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="icon-btn" onClick={() => shift(-1)} disabled={month <= today.slice(0, 7)} aria-label="Previous month"><BackIcon /></button>
        <strong>{label}</strong>
        <button type="button" className="icon-btn" onClick={() => shift(1)} disabled={month >= lastMonth} aria-label="Next month"><ChevronIcon /></button>
      </div>
      <div className="cal-grid">
        {WEEK.map((w) => <span key={w} className="cal-dow">{w}</span>)}
        {days.map((d) => {
          const out = d.slice(0, 7) !== month;
          const booked = inRanges(d, cal.booked);
          const pending = inRanges(d, cal.pending);
          const sel = value?.start && d >= value.start && d <= (selEnd || value.start);
          const cls = [
            'cal-day', out && 'out', d < today && 'past', d === today && 'today',
            booked && (booked.mine ? 'mine' : 'booked'), !booked && pending && 'pending',
            sel && 'sel', select && !blocked(d) && 'pick',
          ].filter(Boolean).join(' ');
          return (
            <button type="button" key={d} className={cls} onClick={() => click(d)} onMouseEnter={() => setHover(d)}
              disabled={select && blocked(d)} aria-label={d}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="cal-legend">
        <span><i className="lg free" /> Free</span>
        <span><i className="lg booked" /> Booked</span>
        <span><i className="lg pending" /> Requested</span>
        {cal.booked.some((b) => b.mine) && <span><i className="lg mine" /> Yours</span>}
      </div>
    </div>
  );
}
