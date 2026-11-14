/**
 * Preset switcher in the bottom bar: shows the preset you're on ("Bass boost",
 * with a dot the moment what you hear differs from it) and opens a list to
 * load another. Every saved preset has a trash can (click, then "Delete?" to
 * confirm); Default is built in and has none. Save, at the top of the list,
 * opens the save window. At the bottom of the list:
 *   Import files…   pick one or several preset files
 *   Import folder…  every preset file in a folder
 * (Equalizer APO .txt, or JSON presets from other Equalizer APO apps.)
 */
import { useRef, useState } from 'react';
import { DEFAULT_PRESET, sameName, usePresetStatus, usePresets, type ImportResult } from '../../state/presets';
import { loadPreset } from '../../state/split';
import { ChevronIcon, TrashIcon } from '../common/icons';
import { SaveModal } from './SaveModal';
import { Button } from '../common/Button';
import { useMenuClose } from '../common/useMenuClose';
import { TOOLTIPS } from '../tooltips';

export function PresetPicker() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { name, isNew } = usePresetStatus();
  const presets = usePresets((s) => s.presets);
  const current = usePresets((s) => s.current);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const importFiles = async (list: FileList) => {
    // Preset files are tiny; skip anything big (pictures, logs…) in a picked folder.
    const small = [...list].filter((f) => f.size > 0 && f.size < 64 * 1024);
    const files = await Promise.all(small.map(async (f) => ({ name: f.name, text: await f.text() })));
    setImported(usePresets.getState().importFiles(files));
    setOpen(true);
  };
  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files?.length) void importFiles(files);
    e.target.value = '';
  };

  // Close the list on Escape or a click anywhere else.
  useMenuClose(rootRef, () => setOpen(false), undefined, open);

  const load = (n: string) => { loadPreset(n); setOpen(false); };
  const names = [DEFAULT_PRESET, ...presets.map((p) => p.name)];

  return (
    <div className="presets" ref={rootRef}>
      <Button className="preset-current" on={open} onClick={() => { setOpen(!open); setImported(null); }}
        aria-haspopup="listbox" aria-expanded={open} title={TOOLTIPS.presets.picker}>
        <span className={`preset-name ${isNew ? 'new' : ''}`}>{name}</span>
        {isNew && <span className="preset-dot" role="img" aria-label="Not saved" title={TOOLTIPS.presets.unsavedDot} />}
        <ChevronIcon />
      </Button>

      {open && (
        <div className="menu preset-menu" role="listbox">
          <button onClick={() => { setOpen(false); setSaving(true); }} title={TOOLTIPS.presets.saveMenuItem}>Save what you hear…</button>
          <hr />
          {/* Edited: none of these is what you hear, so none is marked. */}
          {names.map((n) => (
            <div key={n} className="preset-menu-row">
              <button role="option" aria-selected={!isNew && sameName(n, current)}
                className={`preset-load ${!isNew && sameName(n, current) ? 'on' : ''}`} onClick={() => load(n)}>
                {n}
              </button>
              {n === DEFAULT_PRESET ? null : confirmDelete === n ? (
                <button className="delete confirm" onClick={() => { usePresets.getState().remove(n); setConfirmDelete(null); }}
                  onPointerLeave={() => setConfirmDelete(null)}>
                  Delete?
                </button>
              ) : (
                <button className="icon delete" aria-label={`Delete ${n}`} title={TOOLTIPS.presets.deletePreset}
                  onClick={() => setConfirmDelete(n)}>
                  <TrashIcon />
                </button>
              )}
            </div>
          ))}
          {presets.length === 0 && <div className="menu-note">Saved presets will show up here.</div>}
          <hr />
          <button onClick={() => fileRef.current?.click()} title={TOOLTIPS.presets.importFiles}>
            Import files…
          </button>
          <button onClick={() => folderRef.current?.click()} title={TOOLTIPS.presets.importFolder}>
            Import folder…
          </button>
          {imported && (
            <div className="menu-note" title={imported.warnings.join('\n')}>
              {imported.added.length ? `Imported ${imported.added.length}: ${imported.added.join(', ')}` : 'Nothing imported'}
              {imported.warnings.length > 0 && ` · ${imported.warnings.length} note${imported.warnings.length > 1 ? 's' : ''} (hover)`}
            </div>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" multiple hidden onChange={onPicked} />
      {/* The folder picker: `webkitdirectory` is a browser attribute React doesn't type. */}
      <input ref={folderRef} type="file" multiple hidden onChange={onPicked} {...{ webkitdirectory: '' }} />

      {saving && <SaveModal isNew={isNew} onClose={() => setSaving(false)} />}
    </div>
  );
}
