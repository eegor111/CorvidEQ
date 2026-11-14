/**
 * The power button (top bar, left): is CorvidEQ shaping your sound?
 *
 *   desktop  on = Equalizer APO uses CorvidEQ (your config.txt is saved first);
 *            off = your previous setup comes back exactly (see state/eq-file.ts)
 *   browser  on/off = bypass (B); there is no sound in the browser, so it only changes the look
 *
 * (Desktop: B is a quick bypass instead, see eq-file.ts; config.txt stays as it is.)
 */
import { isDesktop } from '../../audio/spectrum-source';
import { switchOff, switchOn, useEqFile } from '../../state/eq-file';
import { setBypass, useIsBypassed } from '../../state/bypass';
import { PowerIcon } from '../common/icons';
import { TOOLTIPS } from '../tooltips';

export function PowerButton() {
  const file = useEqFile();
  const bypass = useIsBypassed();

  const on = isDesktop ? !!file.included : !bypass;
  const where = file.configDir ?? '';
  const title = TOOLTIPS.topBar.power(isDesktop, on, where);

  const toggle = () => {
    if (!isDesktop) return setBypass(on);
    void (on ? switchOff() : switchOn());
  };

  return (
    <button
      className={`icon-toggle ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={on ? 'CorvidEQ on' : 'CorvidEQ off'}
      title={title}
      disabled={isDesktop && (file.switching || file.state === 'idle')}
      onClick={toggle}
    >
      <PowerIcon />
    </button>
  );
}
