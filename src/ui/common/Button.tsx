/**
 * The one boxed button. Every boxed button in the app (bottom bar, graph
 * toolbar, save window, settings) renders through this, so the base look
 * lives in one place: `.btn` and the "Interaction states" block in
 * index.css (hover = brighter red outline, on = yellow outline).
 *
 * Variants are modifier classes, styled where they're used: `toggle`,
 * `view` (graph toolbar), `icon`, `primary`, `ab-toggle`… `on` = switched
 * on / chosen / open.
 */
import type { ComponentProps } from 'react';

export function Button({ on, className, type = 'button', ...rest }: ComponentProps<'button'> & { on?: boolean }) {
  return <button type={type} className={['btn', className, on && 'on'].filter(Boolean).join(' ')} {...rest} />;
}
