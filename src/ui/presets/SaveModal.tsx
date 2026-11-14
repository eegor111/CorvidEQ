/**
 * Save window. An edited EQ ("New…") starts with an empty name: type a new
 * one, or click a saved preset to overwrite it. (An unchanged preset starts
 * with its own name.)
 *   - a name that already exists  -> "Overwrite" replaces that preset
 *   - a new name                  -> "Save new" adds a preset
 * "Default" is built in: listed first, but it can't be overwritten or deleted.
 * Each saved preset has a delete button that asks once more ("Delete?").
 * "Save file…" (bottom left) saves the EQ as an Equalizer APO file instead.
 *
 * Enter saves (focus stays in the name field), Escape or a click outside closes.
 */
import { useRef, useState } from 'react';
import { DEFAULT_PRESET, findPreset, isDefault, sameName, usePresets } from '../../state/presets';
import { TrashIcon } from '../common/icons';
import { exportFile } from './exportFile';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { TOOLTIPS } from '../tooltips';

export function SaveModal({ isNew, onClose }: { isNew: boolean; onClose(): void }) {
  const presets = usePresets((s) => s.presets);
  const current = usePresets((s) => s.current);
  const { save, remove } = usePresets.getState();
  // Edited: no name yet (overwriting is a deliberate pick from the list).
  // Unchanged: the current name. Never Default: it's read-only.
  const [name, setName] = useState(isNew || isDefault(current) ? '' : current);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const clean = name.trim();
  const existing = clean ? findPreset(presets, clean) : undefined;
  const blocked = isDefault(clean);
  const canSave = clean.length > 0 && !blocked;

  const submit = () => {
    if (!canSave) return;
    save(clean);
    onClose();
  };

  return (
    <Modal label="Save preset" onClose={onClose} onSubmit={submit}>
      <h2>Save preset</h2>

      <input
        className="text-input"
        ref={inputRef}
        autoFocus
        value={name}
        maxLength={40}
        placeholder="New name, or pick a preset below to overwrite"
        onChange={(e) => setName(e.target.value)}
        aria-label="Preset name"
      />

      <div className="preset-list">
        <div className="preset-row">
          <button type="button" className="preset-pick" disabled title={TOOLTIPS.presets.builtInLocked}>
            {DEFAULT_PRESET}
          </button>
          <span className="preset-locked">built in</span>
        </div>
        {presets.map((p) => (
          <div key={p.name} className="preset-row">
            <button type="button" className={`preset-pick ${sameName(p.name, clean) ? 'on' : ''}`}
              onClick={() => { setName(p.name); setConfirmDelete(null); inputRef.current?.focus(); }} title={TOOLTIPS.presets.overwritePick}>
              {p.name}
            </button>
            {confirmDelete === p.name ? (
              <button type="button" className="delete confirm" onClick={() => { remove(p.name); setConfirmDelete(null); }}
                onPointerLeave={() => setConfirmDelete(null)}>
                Delete?
              </button>
            ) : (
              <button type="button" className="icon delete" aria-label={`Delete ${p.name}`} title={TOOLTIPS.presets.deletePreset}
                onClick={() => setConfirmDelete(p.name)}>
                <TrashIcon />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="modal-note">
        {blocked ? `${DEFAULT_PRESET} is built in and can't be changed. Pick another name.`
          : existing ? `This replaces the preset "${existing.name}".`
          : clean ? 'This saves a new preset.' : ''}
      </div>

      <div className="modal-actions">
        {/* Not a preset: the EQ as an Equalizer APO file, named like the preset. */}
        <Button type="button" className="export" title={TOOLTIPS.presets.exportFile}
          onClick={() => void exportFile(clean || (isNew || isDefault(current) ? 'CorvidEQ' : current)).then((saved) => { if (saved) onClose(); })}>
          Save file…
        </Button>
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" className="primary" disabled={!canSave}>
          {existing && !blocked ? 'Overwrite' : 'Save new'}
        </Button>
      </div>
    </Modal>
  );
}
