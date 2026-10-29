import { StudioSource, SynthPresetId } from '../types/studio';

export interface MediaElementRegistry {
  videos: Map<string, HTMLVideoElement>;
  images: Map<string, HTMLImageElement>;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function renderSynthPreset(
  ctx: CanvasRenderingContext2D,
  preset: SynthPresetId,
  x: number,
  y: number,
  w: number,
  h: number,
  timeSec: number,
  audioLevel: number
) {
  ctx.save();

  if (preset === 'lofi-cyber-grid') {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#090D16');
    grad.addColorStop(0.5, '#0F172A');
    grad.addColorStop(1, '#1E1B4B');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // Subtle moving perspective horizon grid
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.18)';
    ctx.lineWidth = 1.5;
    const horizonY = y + h * 0.52;

    for (let i = -10; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(x + w / 2 + i * (w * 0.04), horizonY);
      ctx.lineTo(x + w / 2 + i * (w * 0.16), y + h);
      ctx.stroke();
    }

    const offset = (timeSec * 60) % 40;
    for (let row = 0; row < 14; row++) {
      const py = horizonY + Math.pow((row * 40 + offset) / 560, 1.7) * (h * 0.48);
      if (py <= y + h) {
        ctx.beginPath();
        ctx.moveTo(x, py);
        ctx.lineTo(x + w, py);
        ctx.stroke();
      }
    }

    // Center studio visualizer bars reactive to time + audio
    const barCount = 32;
    const totalBarWidth = w * 0.55;
    const startX = x + (w - totalBarWidth) / 2;
    const barW = (totalBarWidth / barCount) * 0.68;

    for (let b = 0; b < barCount; b++) {
      const wave =
        Math.sin(timeSec * 3.8 + b * 0.35) * 0.4 +
        Math.cos(timeSec * 2.1 - b * 0.2) * 0.3 +
        0.4 +
        audioLevel * 0.6;
      const barH = Math.max(12, Math.min(h * 0.32, wave * (h * 0.24)));
      const bx = startX + b * (totalBarWidth / barCount);
      const by = horizonY - barH - 20;

      const barGrad = ctx.createLinearGradient(bx, by, bx, horizonY - 20);
      barGrad.addColorStop(0, '#60A5FA');
      barGrad.addColorStop(1, '#1D4ED8');
      ctx.fillStyle = barGrad;
      ctx.fillRect(bx, by, barW, barH);
    }

    // Clean studio watermark label
    ctx.fillStyle = 'rgba(248, 250, 252, 0.88)';
    ctx.font = '600 26px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('SINAL DE VÍDEO ATIVO · COMPOSITOR 60 FPS', x + 72, y + 84);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.font = '400 18px "JetBrains Mono", monospace';
    ctx.fillText(
      `TIMECODE ${formatSecondsToTimecode(timeSec)} · H.264 YUV420P · ÁUDIO ESTÉREO 44.1KHZ`,
      x + 72,
      y + 118
    );
  } else if (preset === 'countdown-studio') {
    const grad = ctx.createRadialGradient(
      x + w / 2,
      y + h / 2,
      w * 0.05,
      x + w / 2,
      y + h / 2,
      w * 0.65
    );
    grad.addColorStop(0, '#172554');
    grad.addColorStop(0.6, '#0F172A');
    grad.addColorStop(1, '#060911');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // Rotating precision ring
    const cx = x + w / 2;
    const cy = y + h * 0.44;
    const radius = Math.min(w, h) * 0.22;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    const startAngle = -Math.PI / 2;
    const progress = ((300 - (Math.floor(timeSec) % 300)) / 300) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + progress);
    ctx.stroke();

    const remaining = 300 - (Math.floor(timeSec) % 300);
    const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
    const secs = String(remaining % 60).padStart(2, '0');

    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'center';
    ctx.font = '600 96px "JetBrains Mono", monospace';
    ctx.fillText(`${mins}:${secs}`, cx, cy + 32);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('INICIANDO TRANSMISSÃO AO VIVO', cx, cy - radius - 36);
    ctx.textAlign = 'left';
  } else if (preset === 'ambient-waves') {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#091526');
    grad.addColorStop(0.5, '#0D2137');
    grad.addColorStop(1, '#08101D');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // Smooth harmonic sine layers
    for (let layer = 0; layer < 4; layer++) {
      ctx.beginPath();
      const baseY = y + h * (0.42 + layer * 0.12);
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, baseY);

      for (let px = 0; px <= w; px += 24) {
        const waveY =
          baseY +
          Math.sin(px * 0.004 + timeSec * (1.2 + layer * 0.3) + layer) * (34 + layer * 10) +
          Math.cos(px * 0.009 - timeSec * 0.8) * 18;
        ctx.lineTo(x + px, waveY);
      }
      ctx.lineTo(x + w, y + h);
      ctx.closePath();

      const alphas = [0.22, 0.3, 0.4, 0.55];
      ctx.fillStyle = `rgba(37, 99, 235, ${alphas[layer]})`;
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(241, 245, 249, 0.9)';
    ctx.font = '600 28px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('CANAL 24/7 · REPRODUÇÃO CONTÍNUA', x + 64, y + 80);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.font = '400 18px "JetBrains Mono", monospace';
    ctx.fillText(`QUADRO SINCRONIZADO · ${formatSecondsToTimecode(timeSec)}`, x + 64, y + 114);
  } else {
    // breaking-news-bg
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#1F0910');
    grad.addColorStop(0.5, '#111827');
    grad.addColorStop(1, '#090D16');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // Subtle world meridian rings
    const cx = x + w * 0.5;
    const cy = y + h * 0.48;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.22)';
    ctx.lineWidth = 2;
    for (let r = 1; r <= 4; r++) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * (Math.min(w, h) * 0.09), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Scanning radar sweep
    const angle = timeSec * 1.6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(angle) * (Math.min(w, h) * 0.36),
      cy + Math.sin(angle) * (Math.min(w, h) * 0.36)
    );
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#F8FAFC';
    ctx.font = '600 24px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('CAMADA AUXILIar / SINAL EXTERNO', x + 40, y + 54);
  }

  ctx.restore();
}

export function formatSecondsToTimecode(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const hrs = String(Math.floor(sec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const secs = String(sec % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

export function renderSceneToCanvas(
  ctx: CanvasRenderingContext2D,
  sources: StudioSource[],
  registry: MediaElementRegistry,
  timeSec: number,
  audioLevel: number,
  selectedSourceId: string | null,
  showSelectionHandles: boolean
) {
  const canvasW = ctx.canvas.width;
  const canvasH = ctx.canvas.height;

  // Base neutral black-slate broadcast canvas
  ctx.fillStyle = '#05080F';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Render sources in bottom-to-top painter's order (first item in array = bottom layer, or reverse?
  // Let's make index 0 the background/bottom layer and last item the foreground overlay, matching natural layer composition)
  for (const src of sources) {
    if (!src.visible) continue;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, src.opacity));

    const { x, y, width: w, height: h, borderRadius } = src;

    if (borderRadius > 0) {
      drawRoundedRectPath(ctx, x, y, w, h, borderRadius);
      ctx.clip();
    }

    if (src.type === 'color-backdrop') {
      const grad = ctx.createLinearGradient(x, y, x + w, y + h);
      grad.addColorStop(0, src.gradientStart || '#090D16');
      grad.addColorStop(1, src.gradientEnd || '#1E293B');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    } else if (src.type === 'video-synth') {
      renderSynthPreset(
        ctx,
        src.synthPreset || 'lofi-cyber-grid',
        x,
        y,
        w,
        h,
        timeSec,
        audioLevel
      );
    } else if (
      src.type === 'video-file' ||
      src.type === 'webcam' ||
      src.type === 'screen'
    ) {
      const videoEl = registry.videos.get(src.id);
      if (videoEl && videoEl.readyState >= 2) {
        // Aspect-ratio preserving cover/contain draw
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, y, w, h);
        const vw = videoEl.videoWidth || 1280;
        const vh = videoEl.videoHeight || 720;
        const scale = Math.min(w / vw, h / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = x + (w - dw) / 2;
        const dy = y + (h - dh) / 2;
        ctx.drawImage(videoEl, dx, dy, dw, dh);
      } else {
        // Standby slate while video file / camera initializes
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
        ctx.fillStyle = '#E2E8F0';
        ctx.font = '600 28px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(src.name, x + w / 2, y + h / 2 - 10);
        ctx.fillStyle = '#94A3B8';
        ctx.font = '400 20px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(
          src.type === 'video-file'
            ? 'Carregando arquivo de vídeo...'
            : 'Aguardando permissão de câmera/tela...',
          x + w / 2,
          y + h / 2 + 28
        );
        ctx.textAlign = 'left';
      }
    } else if (src.type === 'image') {
      const imgEl = registry.images.get(src.id);
      if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
        ctx.drawImage(imgEl, x, y, w, h);
      } else {
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(x, y, w, h);
      }
    } else if (src.type === 'lower-third') {
      // Broadcast Lower Third Graphic
      ctx.fillStyle = 'rgba(11, 15, 23, 0.92)';
      ctx.fillRect(x, y, w, h);

      // Left vertical accent bar
      ctx.fillStyle = src.accentColor || '#DC2626';
      ctx.fillRect(x, y, 12, h);

      // Primary headline
      ctx.fillStyle = src.textColor || '#F8FAFC';
      const titleSize = src.fontSize || 30;
      ctx.font = `700 ${titleSize}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillText(
        (src.primaryText || 'TRANSMISSÃO AO VIVO').slice(0, 65),
        x + 34,
        y + h * 0.46
      );

      // Subtitle
      ctx.fillStyle = '#CBD5E1';
      ctx.font = `500 ${Math.round(titleSize * 0.68)}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillText(
        (src.secondaryText || '').slice(0, 95),
        x + 34,
        y + h * 0.8
      );
    } else if (src.type === 'ticker') {
      // Bottom Broadcast News Ticker
      ctx.fillStyle = src.accentColor || '#0F172A';
      ctx.fillRect(x, y, w, h);

      // Top hairline divider
      ctx.fillStyle = '#334155';
      ctx.fillRect(x, y, w, 2);

      //Scrolling text area
      const tickerText =
        src.primaryText ||
        'TRANSMISSÃO AO VIVO PARA O YOUTUBE · COMPOSIÇÃO EM TEMPO REAL';
      ctx.font = `500 ${src.fontSize || 24}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = src.textColor || '#F1F5F9';

      const repeated = `${tickerText}   ·   ${tickerText}   ·   ${tickerText}   ·   `;
      const textWidth = ctx.measureText(tickerText + '   ·   ').width || 800;
      const scrollOffset = (timeSec * 110) % textWidth;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 210, y, w - 210, h);
      ctx.clip();
      ctx.fillText(repeated, x + 220 - scrollOffset, y + h * 0.66);
      ctx.restore();

      // Left live clock block
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(x, y, 210, h);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 22px "JetBrains Mono", monospace';
      const now = new Date();
      const clockStr = now.toTimeString().slice(0, 8);
      ctx.fillText(`AO VIVO ${clockStr}`, x + 18, y + h * 0.66);
    }

    // Optional source border
    if (src.borderWidth > 0) {
      ctx.strokeStyle = src.borderColor || '#3B82F6';
      ctx.lineWidth = src.borderWidth;
      if (borderRadius > 0) {
        drawRoundedRectPath(ctx, x, y, w, h, borderRadius);
        ctx.stroke();
      } else {
        ctx.strokeRect(x, y, w, h);
      }
    }

    ctx.restore();

    // Draw interactive OBS selection frame + resize handle if selected
    if (showSelectionHandles && selectedSourceId === src.id && !src.locked) {
      ctx.save();
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);

      // Corner handles
      const handleSize = 16;
      ctx.fillStyle = '#3B82F6';
      // Top-left
      ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
      // Top-right
      ctx.fillRect(x + w - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
      // Bottom-left
      ctx.fillRect(x - handleSize / 2, y + h - handleSize / 2, handleSize, handleSize);
      // Bottom-right (interactive resize corner)
      ctx.fillStyle = '#60A5FA';
      ctx.fillRect(
        x + w - handleSize / 2,
        y + h - handleSize / 2,
        handleSize + 2,
        handleSize + 2
      );
      ctx.restore();
    }
  }
}
