/**
 * Balance and delay of the output you're listening to, at the bottom bar's
 * right end: the left channel's delay, the balance knob, the right channel's
 * delay, laid out like the speakers. None of it is an EQ edit (state/stereo.ts),
 * so nothing here adds an undo step.
 *
 * Not on mono or surround devices: mono has no L/R, and on surround (`channels > 2`)
 * `Channel: L` / `R` would leave center, sub, and rear speakers untouched.
 */
import { LIMITS } from '../../eapo/types';
import { targetDevice, useAudioSource } from '../../state/audio-source';
import { PARAMS } from '../../state/params';
import { currentStereo, setStereo, useCurrentStereo } from '../../state/stereo';
import { NumberField } from '../common/NumberField';
import { Knob } from '../panel/controls';
import { TOOLTIPS } from '../tooltips';

function balanceText(balance: number) {
  if (balance === 0) return 'Balance: centered';
  const quieter = balance > 0 ? 'left' : 'right';
  if (Math.abs(balance) >= LIMITS.balance.max) return `Balance: ${quieter} side silent`;
  return `Balance: ${quieter} side ${Math.abs(balance).toFixed(1)} dB quieter`;
}

function DelayField({ side, name, value }: { side: 'delayL' | 'delayR'; name: string; value: number }) {
  return (
    <NumberField className="delay" undoable={false} dragPx={1}
      text={`+${value.toFixed(2)} ms`} edit={value.toFixed(2)} label={`${name} channel delay`}
      title={TOOLTIPS.bottomBar.delay(name)}
      onStep={(dir, fine) => setStereo({ [side]: PARAMS.delay.step(currentStereo()[side], dir, fine) })}
      onCommit={(t) => {
        const typed = parseFloat(t.replace(',', '.'));
        if (Number.isFinite(typed)) setStereo({ [side]: typed });
      }} />
  );
}

export function StereoControls() {
  const { balance, delayL, delayR } = useCurrentStereo();
  const notStereo = useAudioSource((s) => {
    const channels = targetDevice(s)?.format?.channels;
    return channels !== undefined && channels !== 2;
  });
  if (notStereo) return null;
  return (
    <div className="group">
      <DelayField side="delayL" name="Left" value={delayL} />
      <div className="balance">
        <Knob centered undoable={false} focusId="balance" label="Balance" color="var(--accent)"
          title={TOOLTIPS.bottomBar.balance(balanceText(balance))}
          norm={PARAMS.balance.toNorm(balance)}
          setNorm={(n) => setStereo({ balance: PARAMS.balance.fromNorm(n) })}
          step={(dir, fine) => setStereo({ balance: PARAMS.balance.step(currentStereo().balance, dir, fine) })}
          reset={() => setStereo({ balance: 0 })} />
        <span className="left">L</span>
        <span className="right">R</span>
      </div>
      <DelayField side="delayR" name="Right" value={delayR} />
    </div>
  );
}
