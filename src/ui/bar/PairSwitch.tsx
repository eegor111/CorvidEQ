/**
 * Two letters on ONE button (A/B, L/R): a click anywhere on it switches to the
 * other, and the letter you're on is lit. Styles: `.pair-switch` in index.css.
 */
import { Button } from '../common/Button';

export function PairSwitch<T extends string>({ options, value, onSwitch, label, title }: {
  options: readonly [T, T];
  value: T;
  onSwitch(next: T): void;
  /** Accessible name, e.g. "A/B comparison". */
  label: string;
  title: string;
}) {
  const other = value === options[0] ? options[1] : options[0];
  return (
    <Button className="pair-switch" onClick={() => onSwitch(other)} aria-label={`${label}: on ${value}, click for ${other}`} title={title}>
      {options.map((o) => <span key={o} className={o === value ? 'on' : ''}>{o}</span>)}
    </Button>
  );
}
