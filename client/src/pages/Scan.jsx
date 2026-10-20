import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import jsQR from 'jsqr';
import { PageHead } from '../components/ui.jsx';
import { decodeImage } from '../lib/image.js';

function tokenFrom(text) {
  const m = String(text).match(/\/i\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

// Works on iPhone (Safari 14.3+ and Home Screen app) and Android. Needs https.
export default function Scan() {
  const nav = useNavigate();
  const video = useRef(null);
  const canvas = useRef(null);
  const [err, setErr] = useState('');
  const [found, setFound] = useState('');

  useEffect(() => {
    let stream; let raf; let stop = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera api');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current;
        v.setAttribute('playsinline', ''); // iOS: play inside the page, not fullscreen
        v.muted = true;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (stop) return;
          const c = canvas.current;
          if (v.readyState >= 2 && v.videoWidth) {
            // scan a smaller copy – faster on phones
            const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
            c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' });
            if (code?.data) {
              const t = tokenFrom(code.data);
              if (t) { stop = true; nav(`/i/${t}`); return; }
              setFound('That QR code is not a BorrowBox item.');
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setErr('Camera not available. Allow camera access (on iPhone: Settings → Safari → Camera), or just scan the label with your phone’s camera app.');
      }
    })();
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [nav]);

  const fromFile = async (file) => {
    try {
      const img = await decodeImage(file);
      const c = canvas.current;
      const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.drawImage(img.src, 0, 0, c.width, c.height);
      img.done();
      const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      const t = code && tokenFrom(code.data);
      if (t) nav(`/i/${t}`); else setFound('No BorrowBox QR code found in that photo.');
    } catch { setFound('Could not read that photo.'); }
  };

  return (
    <div className="page narrow">
      <PageHead title="Scan item QR" sub="Point the camera at the QR label on the item. It opens the handover or return screen." />
      <div className="scanner">
        <video ref={video} playsInline muted autoPlay />
        <div className="scanner-frame" />
      </div>
      <canvas ref={canvas} hidden />
      {err && <p className="notice">{err}</p>}
      {found && <p className="notice">{found}</p>}
      <label className="btn btn-block mt">Or choose a photo of the QR<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) fromFile(f); }} /></label>
    </div>
  );
}
