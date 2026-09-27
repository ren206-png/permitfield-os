'use client';

import { useEffect, useRef, useState } from 'react';
import { ESIGN_CONSENT_TEXT, type SignatureMethod } from '@/lib/esign/signature';

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 140;

// Renders the consent checkbox and a typed-or-drawn signature inside the
// caller's <form>. Inputs are controlled so a server-side validation error
// (React resets uncontrolled fields after a form action) doesn't wipe them. Submits three fields: esignConsent ("yes" when ticked),
// signatureMethod ("typed" | "drawn"), and signatureDataUrl (a PNG data URL,
// only meaningful when drawn). `typedName` is the signer's name from the
// surrounding form, previewed as their typed signature.
export function SignatureField({ typedName }: { typedName: string }) {
  const [method, setMethod] = useState<SignatureMethod>('typed');
  const [dataUrl, setDataUrl] = useState('');
  const [consented, setConsented] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, [method]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    setDataUrl(event.currentTarget.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setDataUrl('');
  }

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-medium ${
      active ? 'bg-zinc-900 text-white' : 'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
    }`;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm text-zinc-700">Signature</legend>
      <input type="hidden" name="signatureMethod" value={method} />
      <input type="hidden" name="signatureDataUrl" value={method === 'drawn' ? dataUrl : ''} />

      <div className="flex gap-2" role="group" aria-label="Signature method">
        <button type="button" className={tabClass(method === 'typed')} aria-pressed={method === 'typed'} onClick={() => setMethod('typed')}>
          Type
        </button>
        <button type="button" className={tabClass(method === 'drawn')} aria-pressed={method === 'drawn'} onClick={() => setMethod('drawn')}>
          Draw
        </button>
      </div>

      {method === 'typed' ? (
        <div className="flex h-[88px] items-center rounded-md border border-dashed border-zinc-300 bg-white px-4">
          <span className="truncate font-serif text-3xl italic text-zinc-900" aria-live="polite">
            {typedName.trim() || <span className="text-base not-italic text-zinc-400">Your typed name appears here</span>}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            aria-label="Draw your signature"
            className="h-[140px] w-full max-w-[480px] touch-none rounded-md border border-dashed border-zinc-300 bg-white"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
          />
          <button type="button" onClick={clear} className="self-start text-xs font-medium text-zinc-600 underline underline-offset-2">
            Clear
          </button>
        </div>
      )}

      <label className="flex items-start gap-2 text-xs text-zinc-700">
        <input
          type="checkbox"
          name="esignConsent"
          value="yes"
          required
          checked={consented}
          onChange={(event) => setConsented(event.target.checked)}
          className="mt-0.5"
        />
        <span>{ESIGN_CONSENT_TEXT}</span>
      </label>
    </fieldset>
  );
}
