/**
 * Save the current EQ as an Equalizer APO config file (Save window's
 * "Save file…"), to share it or keep a copy. Browser: a download. Desktop:
 * Windows' Save window, then Rust writes the file (a web page can't write
 * files itself). Returns false if nothing was saved (cancelled or failed).
 */
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { isDesktop } from '../../audio/spectrum-source';
import { serializeConfig } from '../../eapo/format';
import { useEq } from '../../state/store';

export function exportFile(name: string): Promise<boolean> {
  return saveTextFile(`${safeFileName(name, 'CorvidEQ')}.txt`, serializeConfig(useEq.getState().settings), 'Equalizer APO config');
}

/** A file name without the characters Windows forbids. */
export const safeFileName = (name: string, fallback: string) => name.replace(/[\\/:*?"<>|]/g, '').trim() || fallback;

/**
 * Save text as a file the user picks (desktop: Windows' Save window, Rust
 * writes it; browser: a download). `fileName`'s extension is the only
 * type offered.
 */
export async function saveTextFile(fileName: string, text: string, typeName: string): Promise<boolean> {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1);
  if (isDesktop) {
    const path = await save({ defaultPath: fileName, filters: [{ name: typeName, extensions: [ext] }] });
    if (!path) return false;
    try {
      await invoke('export_config', { path, text });
      return true;
    } catch (err) {
      alert(String(err));
      return false;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  Object.assign(document.createElement('a'), { href: url, download: fileName }).click();
  URL.revokeObjectURL(url);
  return true;
}
