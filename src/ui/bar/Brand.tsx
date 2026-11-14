/**
 * The app's icon and name in the top bar. A click opens the About window.
 */
import { useState } from 'react';
import { AboutContent } from '../common/About';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { TOOLTIPS } from '../tooltips';

export function Brand() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="brand" onClick={() => setOpen(true)} title={TOOLTIPS.topBar.brand}>
        <img src="/icon.svg" alt="" draggable={false} />
        CorvidEQ
      </Button>
      {open && (
        <Modal label="About CorvidEQ" className="about" onClose={() => setOpen(false)}>
          <AboutContent onClose={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}
