import { minutesSinceMidnight } from '../../domain/dates';
import { minuteToPixel } from '../../domain/geometry';

type Props = {
  now: Date;
  date: string;
};

export function NowLine({ now, date }: Props) {
  return (
    <div
      className="now-line"
      style={{ top: minuteToPixel(minutesSinceMidnight(now, date)) }}
      aria-hidden
    />
  );
}
