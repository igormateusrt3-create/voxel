import React, { useEffect, useRef, useState } from 'react';
import {
  Cloud,
  Upload,
  Radio,
  Square,
  Trash2,
  Eye,
  EyeOff,
  Terminal,
  CheckCircle2,
  RefreshCw,
  HardDrive,
  Link as LinkIcon,
  Cpu,
  ShieldCheck,
  Server,
  ExternalLink,
  HelpCircle,
  Volume2,
  VolumeX,
  Activity,
  Zap,
} from 'lucide-react';
import { YouTubeRtmpConfig } from '../types/studio';
import { formatSecondsToTimecode } from '../utils/canvasRenderer';

interface ServerVideoItem {
  id: string;
  originalName: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface CloudStreamServerState {
  active: boolean;
  mode: 'youtube' | 'simulation';
  sourceMode:
    | 'google-drive'
    | 'uploaded-file'
    | 'remote-url'
    | 'server-test-pattern'
    | 'youtube-link';
  sourceLabel: string;
  maskedTarget: string;
  startedAt: number | null;
  elapsedSeconds: number;
  frames: number;
  fps: number;
  bitrateKbps: number;
  ffmpegTime: string;
  loopInfinite: boolean;
  loopCycle?: number;
  resolution: string;
  statusMessage: string;
  logs: string[];
}

interface KeepAliveServerState {
  enabled: boolean;
  intervalSeconds: number;
  totalPingsSent: number;
  lastPingAt: string | null;
  lastPingStatus: string;
  lastPingLatencyMs: number;
  detectedPublicUrl: string;
}

interface CloudAutonomousViewProps {
  rtmpConfig: YouTubeRtmpConfig;
  onUpdateRtmpConfig: (updated: YouTubeRtmpConfig) => void;
  onReturnToStudio: () => void;
}

async function safeJson<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `O servidor retornou uma resposta inesperada (Status HTTP ${res.status}). Aguarde alguns instantes e tente novamente.`
    );
  }
}

export const CloudAutonomousView: React.FC<CloudAutonomousViewProps> = ({
  rtmpConfig,
  onUpdateRtmpConfig,
  onReturnToStudio,
}) => {
  const [serverState, setServerState] = useState<CloudStreamServerState | null>(null);
  const [keepAlive, setKeepAlive] = useState<KeepAliveServerState | null>(null);
  const [serverVideos, setServerVideos] = useState<ServerVideoItem[]>([]);
  const [selectedSourceMode, setSelectedSourceMode] = useState<
    'google-drive' | 'uploaded-file' | 'youtube-link' | 'remote-url' | 'server-test-pattern'
  >('google-drive');
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [remoteUrl, setRemoteUrl] = useState<string>('');
  const [youtubeUrl, setYoutubeUrl] = useState<string>(
    'https://www.youtube.com/live/ZCKgoFyh2hI'
  );
  const [youtubeMeta, setYoutubeMeta] = useState<{
    videoId: string;
    title: string;
    authorName: string;
    thumbnailUrl: string;
  }>({
    videoId: 'ZCKgoFyh2hI',
    title: 'lo-fi relaxante',
    authorName: 'canal xgx',
    thumbnailUrl: 'https://i.ytimg.com/vi/ZCKgoFyh2hI/hqdefault.jpg',
  });
  const [cookiesTxt, setCookiesTxt] = useState<string>('');
  const [showCookiesBox, setShowCookiesBox] = useState<boolean>(false);
  const [importingYt, setImportingYt] = useState<boolean>(false);
  const [loopInfinite, setLoopInfinite] = useState<boolean>(true);
  const [showKey, setShowKey] = useState<boolean>(false);
  const [forceKeyframes, setForceKeyframes] = useState<boolean>(true);
  const [showDeployGuide, setShowDeployGuide] = useState<boolean>(false);
  const [simulatedAccessActive, setSimulatedAccessActive] = useState<boolean>(true);
  const [audioKeepAliveActive, setAudioKeepAliveActive] = useState<boolean>(false);
  const [simulatedPingCount, setSimulatedPingCount] = useState<number>(0);
  const audioCtxRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgressPct, setUploadProgressPct] = useState<number>(0);
  const [uploadStatsLabel, setUploadStatsLabel] = useState<string>('');
  const [uploadMessage, setUploadMessage] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [driveImportUrl, setDriveImportUrl] = useState<string>('');
  const [driveImporting, setDriveImporting] = useState<boolean>(false);
  const [driveImportMsg, setDriveImportMsg] = useState<string>('');

  const detectedDriveId = (() => {
    const match =
      driveImportUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
      driveImportUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  })();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchCloudStatus = async () => {
    try {
      const res = await fetch('/api/cloud-stream/status');
      if (res.ok) {
        const data = await res.json();
        setServerState(data.state);
        if (data.keepAlive) {
          setKeepAlive(data.keepAlive);
        }
        setServerVideos(data.videos || []);
        if (
          data.videos &&
          data.videos.length > 0 &&
          !selectedVideoId
        ) {
          setSelectedVideoId(data.videos[0].id);
        }
      }
    } catch {
      // ignore poll error
    }
  };

  // Unthrottled Web Worker keep-alive poller & Screen WakeLock
  useEffect(() => {
    fetchCloudStatus();
    let worker: Worker | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;

    try {
      const workerCode = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (timer) clearInterval(timer);
            timer = setInterval(function() {
              self.postMessage('tick');
            }, 2500);
          } else if (e.data === 'stop') {
            if (timer) clearInterval(timer);
            timer = null;
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = () => {
        setSimulatedPingCount((c) => c + 1);
        fetchCloudStatus();
      };
      worker.postMessage('start');
    } catch {
      fallbackTimer = setInterval(() => {
        setSimulatedPingCount((c) => c + 1);
        fetchCloudStatus();
      }, 2000);
    }

    // Try requesting Screen WakeLock
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && (navigator as any).wakeLock) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        }
      } catch {}
    };
    requestWakeLock();

    const handleVis = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVis);

    return () => {
      document.removeEventListener('visibilitychange', handleVis);
      if (worker) {
        worker.postMessage('stop');
        worker.terminate();
      }
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (wakeLockRef.current) {
        try {
          wakeLockRef.current.release();
        } catch {}
        wakeLockRef.current = null;
      }
    };
  }, []);

  const toggleAudioKeepalive = () => {
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0.00001;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          audioCtxRef.current = ctx;
          setAudioKeepAliveActive(true);
        }
      } else {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
        setAudioKeepAliveActive(false);
      }
    } catch {
      // audio context not allowed without user gesture
    }
  };

  const handleFetchYouTubeMeta = async (urlToLookup: string) => {
    try {
      const res = await fetch(
        `/api/youtube/info?url=${encodeURIComponent(urlToLookup)}`
      );
      const data = await res.json();
      if (res.ok && data.valid) {
        setYoutubeMeta({
          videoId: data.videoId,
          title: data.title,
          authorName: data.authorName,
          thumbnailUrl: data.thumbnailUrl,
        });
      }
    } catch {
      // ignore
    }
  };

  const handleImportYouTubeToServer = async () => {
    setImportingYt(true);
    setActionError('');
    setUploadMessage('');
    try {
      const res = await fetch('/api/cloud-stream/import-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl,
          cookiesTxt,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.video) {
        setUploadMessage(
          `Vídeo do YouTube "${data.video.originalName}" importado para o servidor! Pronto para transmitir 24/7.`
        );
        setSelectedSourceMode('uploaded-file');
        setSelectedVideoId(data.video.id);
        await fetchCloudStatus();
      } else {
        if (data.requiresAuth) {
          setShowCookiesBox(true);
        }
        setActionError(
          data.message || 'Não foi possível importar diretamente do YouTube.'
        );
      }
    } catch {
      setActionError('Erro ao comunicar com o importador do YouTube no servidor.');
    } finally {
      setImportingYt(false);
    }
  };

  const handleUploadToServer = async (file: File) => {
    setUploading(true);
    setUploadProgressPct(0);
    setUploadMessage('');
    setActionError('');

    const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB per chunk (safely below Cloud Run 32MB request limit)
    const totalBytes = file.size;
    const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
    const uploadId = `srv-vid-${Date.now()}`;
    let offset = 0;
    let uploadedVideoId = '';

    try {
      while (offset < totalBytes) {
        const nextOffset = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = file.slice(offset, nextOffset);
        const isLastChunk = nextOffset >= totalBytes;

        const currentMb = (offset / (1024 * 1024)).toFixed(1);
        setUploadStatsLabel(
          `Transferindo "${file.name}": ${currentMb} MB de ${totalMb} MB...`
        );

        const res = await fetch('/api/cloud-stream/upload-chunk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-upload-id': uploadId,
            'x-file-name': encodeURIComponent(file.name),
            'x-is-last-chunk': isLastChunk ? 'true' : 'false',
          },
          body: chunk,
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || 'Falha ao enviar bloco de vídeo.');
        }

        offset = nextOffset;
        const pct = Math.min(100, Math.round((offset / totalBytes) * 100));
        setUploadProgressPct(pct);

        if (isLastChunk && data.video) {
          uploadedVideoId = data.video.id;
        }
      }

      setUploadStatsLabel('');
      setUploadMessage(
        `Vídeo "${file.name}" (${totalMb} MB) salvo no servidor! Pronto para transmitir.`
      );
      setSelectedSourceMode('uploaded-file');
      if (uploadedVideoId) {
        setSelectedVideoId(uploadedVideoId);
      }
      await fetchCloudStatus();

      // Automatically launch autonomous live transmission with this newly uploaded video!
      if (uploadedVideoId) {
        if (rtmpConfig.streamKey && rtmpConfig.streamKey.trim().length > 4) {
          setUploadMessage(
            `Vídeo "${file.name}" (${totalMb} MB) salvo! Iniciando transmissão autônoma no YouTube Live...`
          );
          try {
            const startRes = await fetch('/api/cloud-stream/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: rtmpConfig.mode,
                sourceMode: 'uploaded-file',
                videoId: uploadedVideoId,
                remoteUrl,
                rtmpUrl: rtmpConfig.ingestServerUrl,
                streamKey: rtmpConfig.streamKey,
                loopInfinite,
                resolution: rtmpConfig.resolution,
                fps: rtmpConfig.fps,
                videoBitrateKbps: rtmpConfig.videoBitrateKbps,
                audioBitrateKbps: rtmpConfig.audioBitrateKbps,
                forceKeyframes,
              }),
            });
            const startData = await safeJson(startRes);
            if (startRes.ok && startData.success) {
              setServerState(startData.state);
              setUploadMessage(
                `✅ Vídeo "${file.name}" salvo no servidor e transmitindo AO VIVO para o YouTube Studio!`
              );
            } else {
              setActionError(startData.message || 'Vídeo salvo. Clique em "Iniciar Transmissão no Servidor" abaixo.');
            }
          } catch (e: any) {
            setActionError(e.message || 'Falha ao iniciar transmissão automática.');
          }
        } else {
          setUploadMessage(
            `Vídeo "${file.name}" salvo no servidor! Insira sua Chave de Transmissão do YouTube e clique em "Iniciar Transmissão no Servidor" abaixo.`
          );
        }
      }
    } catch (err) {
      setActionError(
        (err as Error).message ||
          'Erro de rede ao transferir o arquivo de vídeo para o servidor.'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteServerVideo = async (id: string) => {
    try {
      await fetch(`/api/cloud-stream/videos/${id}`, { method: 'DELETE' });
      await fetchCloudStatus();
    } catch {
      // ignore
    }
  };

  const handleImportDrive = async (targetUrl?: string) => {
    const urlToUse = (targetUrl || driveImportUrl || remoteUrl).trim();
    if (!urlToUse) {
      setActionError('Cole o link do Google Drive ou link direto .mp4.');
      return;
    }
    setDriveImporting(true);
    setDriveImportMsg('Conectando ao Google Drive e baixando para o servidor...');
    setActionError('');
    try {
      const res = await fetch('/api/server-videos/import-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToUse }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao importar do Google Drive.');
      }
      setDriveImportMsg(`Vídeo "${data.video.originalName}" importado com sucesso para o servidor!`);
      await fetchCloudStatus();
      setSelectedSourceMode('uploaded-file');
      setSelectedVideoId(data.video.id);
      setDriveImportUrl('');
    } catch (err: any) {
      setActionError(`Erro ao importar do Google Drive: ${err.message}`);
    } finally {
      setDriveImporting(false);
    }
  };

  const handleStartAutonomousStream = async () => {
    setActionError('');
    if (selectedSourceMode === 'google-drive' && !driveImportUrl.trim()) {
      setActionError('Cole o link do Google Drive para iniciar a transmissão.');
      return;
    }
    try {
      const res = await fetch('/api/cloud-stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: rtmpConfig.mode,
          sourceMode: selectedSourceMode,
          driveUrl: driveImportUrl,
          youtubeUrl: youtubeUrl || 'https://www.youtube.com/live/ZCKgoFyh2hI',
          videoId: selectedVideoId,
          remoteUrl: selectedSourceMode === 'google-drive' ? driveImportUrl : remoteUrl,
          rtmpUrl: rtmpConfig.ingestServerUrl,
          streamKey: rtmpConfig.streamKey,
          loopInfinite,
          resolution: rtmpConfig.resolution,
          fps: rtmpConfig.fps,
          videoBitrateKbps: rtmpConfig.videoBitrateKbps,
          audioBitrateKbps: rtmpConfig.audioBitrateKbps,
          forceKeyframes,
        }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data.success) {
        setActionError(
          data.message || 'Não foi possível iniciar a transmissão autônoma.'
        );
      } else {
        setServerState(data.state);
      }
    } catch (err: any) {
      setActionError(err.message || 'Falha ao comunicar com o servidor de transmissão.');
    }
  };

  const handleStopAutonomousStream = async () => {
    try {
      const res = await fetch('/api/cloud-stream/stop', { method: 'POST' });
      const data = await res.json();
      if (data.state) {
        setServerState(data.state);
      }
    } catch {
      // ignore
    }
  };

  const isCloudRunning = Boolean(serverState?.active);

  return (
    <div className="max-w-5xl mx-auto py-8 px-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 tracking-tight flex items-center gap-2.5">
            <Cloud className="w-6 h-6 text-blue-400" />
            Modo Nuvem 24/7 — Continuar Transmitindo com o PC Desligado
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Envie seu vídeo para o servidor. O processo FFmpeg roda diretamente em segundo plano na nuvem com repetição contínua (<code className="font-mono text-slate-300">-stream_loop -1</code>), sem depender do seu navegador aberto ou do seu computador ligado.
          </p>
        </div>
        <button
          type="button"
          onClick={onReturnToStudio}
          className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap self-start"
        >
          Voltar à Mesa de Corte
        </button>
      </div>

      {/* Comparison Banner: Why Browser Mode stops vs Why Cloud Mode keeps running */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
          <div className="text-xs font-mono text-slate-400">
            MODO 01 · ESTÚDIO AO VIVO NO NAVEGADOR
          </div>
          <div className="text-sm font-semibold text-slate-200 mt-1">
            Depende do PC Ligado e Aba Aberta
          </div>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
            Ideal para lives interativas com webcam, microfone e troca de cenas manual. Como os quadros são desenhados pelo navegador do seu PC, desligar o computador encerra o envio.
          </p>
        </div>

        <div className="bg-blue-950/20 border border-blue-800/60 rounded-lg p-4">
          <div className="text-xs font-mono text-blue-400">
            MODO 02 · TRANSMISSÃO AUTÔNOMA NO SERVIDOR (ESTA ABA)
          </div>
          <div className="text-sm font-semibold text-slate-100 mt-1">
            Continua Mesmo se Você Fechar o Site ou Desligar o PC
          </div>
          <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
            O arquivo de vídeo <code className="font-mono">.MP4</code> fica hospedado no disco do servidor. O próprio servidor lê o vídeo e envia direto via RTMP para o YouTube 24h por dia.
          </p>
        </div>
      </div>

      {/* Live Status Banner of the Server Process */}
      <div
        className={`mt-6 p-5 rounded-lg border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${
          isCloudRunning
            ? 'bg-emerald-950/25 border-emerald-700/70'
            : 'bg-[#111827] border-slate-800'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span
              className={
                isCloudRunning
                  ? 'text-emerald-400 font-semibold'
                  : 'text-slate-400'
              }
            >
              {isCloudRunning
                ? '● PROCESSO FFMPEG RODANDO SOZINHO NO SERVIDOR'
                : '○ SERVIDOR AUTÔNOMO EM ESPERA'}
            </span>
            {isCloudRunning && serverState && (
              <>
                <span className="text-slate-500">·</span>
                <span className="text-slate-200 tabular-nums">
                  Tempo Ativo: {formatSecondsToTimecode(serverState.elapsedSeconds)}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-200 tabular-nums">
                  {serverState.frames} quadros ({serverState.bitrateKbps} kbps)
                </span>
                {serverState.loopInfinite && (
                  <>
                    <span className="text-slate-500">·</span>
                    <span className="text-emerald-400 font-semibold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-700/60">
                      Loop 24/7: Ciclo #{serverState.loopCycle || 1}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="text-sm font-medium text-slate-200">
            {serverState?.statusMessage || 'Carregando estado do servidor...'}
          </div>
          {isCloudRunning && serverState && (
            <div className="text-xs text-slate-400 font-mono">
              Fonte: {serverState.sourceLabel} · Destino: {serverState.maskedTarget}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {isCloudRunning ? (
            <button
              type="button"
              onClick={handleStopAutonomousStream}
              className="px-4 py-2.5 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2 whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Parar Transmissão no Servidor
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartAutonomousStream}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2 whitespace-nowrap"
            >
              <Radio className="w-4 h-4" />
              Iniciar Transmissão no Servidor (Pode Desligar o PC)
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="mt-4 p-4 bg-red-950/40 border border-red-800 rounded-lg text-xs text-red-200 space-y-3">
          <div className="flex items-start gap-2.5">
            <span className="text-base shrink-0 mt-0.5">⚠️</span>
            <div className="flex-1 leading-relaxed">
              <div className="font-semibold text-red-100 mb-1">
                Aviso da Transmissão no Servidor:
              </div>
              <div className="text-slate-200">{actionError}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-red-900/60">
            <button
              type="button"
              onClick={() => {
                setSelectedSourceMode('uploaded-file');
                setActionError('');
              }}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium text-xs transition-colors flex items-center gap-1.5 shadow"
            >
              <HardDrive className="w-3.5 h-3.5" />
              Usar Vídeo Enviado (.MP4) — Solução 100% Estável 24/7
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedSourceMode('server-test-pattern');
                setActionError('');
              }}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs transition-colors"
            >
              Testar com Gerador do Servidor
            </button>
          </div>
        </div>
      )}

      {/* Configuration Grid: 1. Video Source on Server | 2. YouTube Stream Key */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Column 1: Choose Video Source on Server */}
        <div className="lg:col-span-7 space-y-5">
          <h2 className="text-base font-semibold text-slate-100">
            1. Escolha o Vídeo que o Servidor Vai Transmitir
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <button
              type="button"
              onClick={() => setSelectedSourceMode('google-drive')}
              className={`p-3 rounded-lg border text-left transition-colors relative overflow-hidden ${
                selectedSourceMode === 'google-drive'
                  ? 'bg-emerald-950/40 border-emerald-500 text-slate-100 ring-1 ring-emerald-500/50'
                  : 'bg-[#111827] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <Cloud className="w-4 h-4 text-emerald-400" />
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Estável
                </span>
              </div>
              <div className="text-xs font-semibold text-emerald-200">Google Drive (.MP4)</div>
              <div className="text-[11px] opacity-80 mt-0.5">
                Link de compartilhamento
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedSourceMode('uploaded-file')}
              className={`p-3 rounded-lg border text-left transition-colors ${
                selectedSourceMode === 'uploaded-file'
                  ? 'bg-blue-950/40 border-blue-500 text-slate-100 ring-1 ring-blue-500/50'
                  : 'bg-[#111827] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <HardDrive className="w-4 h-4 text-blue-400 mb-1.5" />
              <div className="text-xs font-semibold">Vídeo Enviado (.MP4)</div>
              <div className="text-[11px] opacity-80 mt-0.5">
                Salvo no disco do servidor
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedSourceMode('youtube-link')}
              className={`p-3 rounded-lg border text-left transition-colors ${
                selectedSourceMode === 'youtube-link'
                  ? 'bg-red-950/35 border-red-500 text-slate-100'
                  : 'bg-[#111827] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="w-4 h-4 text-red-400 mb-1.5" />
              <div className="text-xs font-semibold">Link do YouTube</div>
              <div className="text-[11px] opacity-80 mt-0.5">
                lo-fi relaxante
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedSourceMode('remote-url')}
              className={`p-3 rounded-lg border text-left transition-colors ${
                selectedSourceMode === 'remote-url'
                  ? 'bg-blue-950/40 border-blue-500 text-slate-100'
                  : 'bg-[#111827] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <LinkIcon className="w-4 h-4 text-blue-400 mb-1.5" />
              <div className="text-xs font-semibold">Link Direto (.MP4)</div>
              <div className="text-[11px] opacity-80 mt-0.5">
                URL pública de vídeo
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedSourceMode('server-test-pattern')}
              className={`p-3 rounded-lg border text-left transition-colors ${
                selectedSourceMode === 'server-test-pattern'
                  ? 'bg-blue-950/40 border-blue-500 text-slate-100'
                  : 'bg-[#111827] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-4 h-4 text-blue-400 mb-1.5" />
              <div className="text-xs font-semibold">Gerador do Servidor</div>
              <div className="text-[11px] opacity-80 mt-0.5">
                Sinal de teste instantâneo
              </div>
            </button>
          </div>

          {/* Google Drive Dedicated Source View */}
          {selectedSourceMode === 'google-drive' && (
            <div className="bg-[#111827] border border-emerald-900/60 rounded-lg p-5 space-y-4 shadow-lg shadow-emerald-950/20">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <Cloud className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                      <span>Transmissão via Google Drive (Nuvem 24/7)</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        100% Estável
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Conecte o link do seu vídeo hospedado no Google Drive para transmitir 24 horas por dia com loop infinito e zero uso da sua máquina.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-200">
                  Cole o Link de Compartilhamento do Google Drive:
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={driveImportUrl}
                    onChange={(e) => {
                      setDriveImportUrl(e.target.value);
                      if (actionError) setActionError('');
                    }}
                    placeholder="https://drive.google.com/file/d/SEU_ID/view?usp=sharing"
                    className="flex-1 px-3.5 py-2.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    disabled={driveImporting || !driveImportUrl.trim()}
                    onClick={() => handleImportDrive()}
                    className="px-4 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg whitespace-nowrap flex items-center gap-1.5 shadow transition-colors"
                    title="Baixa diretamente da nuvem para o disco do servidor para máxima estabilidade"
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    {driveImporting ? 'Baixando...' : 'Salvar no Servidor'}
                  </button>
                </div>

                {detectedDriveId && (
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono pt-0.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ID do arquivo reconhecido: {detectedDriveId}
                  </div>
                )}

                {driveImportMsg && (
                  <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded text-xs text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{driveImportMsg}</span>
                  </div>
                )}
              </div>

              {/* Action Box */}
              <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-3">
                <div className="text-xs text-slate-300 flex items-center justify-between">
                  <span className="font-medium text-slate-200">Transmitir para a Live:</span>
                  <span className="text-[11px] text-slate-400">Loop infinito automático</span>
                </div>

                {isCloudRunning ? (
                  <button
                    type="button"
                    onClick={handleStopAutonomousStream}
                    className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors flex items-center justify-center gap-2"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Parar Transmissão no Servidor
                  </button>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={!driveImportUrl.trim()}
                      onClick={handleStartAutonomousStream}
                      className="py-3 px-4 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-2 shadow"
                    >
                      <Radio className="w-4 h-4" />
                      Transmitir Direto do Google Drive
                    </button>
                    <button
                      type="button"
                      disabled={driveImporting || !driveImportUrl.trim()}
                      onClick={() => handleImportDrive()}
                      className="py-3 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-2 shadow"
                    >
                      <HardDrive className="w-4 h-4" />
                      {driveImporting ? 'Baixando...' : 'Salvar no Servidor & Rodar 24/7'}
                    </button>
                  </div>
                )}
              </div>

              {/* Step by step tutorial */}
              <div className="p-4 bg-emerald-950/20 border border-emerald-800/40 rounded-lg space-y-2.5 text-xs text-slate-300">
                <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                  <span>📌</span> Como preparar seu vídeo no Google Drive em 3 passos:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <div className="p-2.5 bg-[#0B0F17]/80 rounded border border-slate-800">
                    <div className="text-[11px] font-semibold text-emerald-400 mb-1">
                      1. Envie para o Drive
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Faça o upload do seu arquivo de vídeo <code>.mp4</code> para a sua conta do Google Drive.
                    </div>
                  </div>
                  <div className="p-2.5 bg-[#0B0F17]/80 rounded border border-slate-800">
                    <div className="text-[11px] font-semibold text-emerald-400 mb-1">
                      2. Compartilhe Público
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Botão direito no arquivo &rarr; Compartilhar &rarr; mude Acesso geral para <strong>Qualquer pessoa com o link</strong>.
                    </div>
                  </div>
                  <div className="p-2.5 bg-[#0B0F17]/80 rounded border border-slate-800">
                    <div className="text-[11px] font-semibold text-emerald-400 mb-1">
                      3. Cole e Inicie
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Clique em "Copiar link", cole aqui no campo e clique em <strong>Salvar no Servidor</strong>!
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedSourceMode === 'youtube-link' && (
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  Link do seu Vídeo ou Live no YouTube
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => {
                      setYoutubeUrl(e.target.value);
                      handleFetchYouTubeMeta(e.target.value);
                    }}
                    placeholder="https://www.youtube.com/live/ZCKgoFyh2hI"
                    className="flex-1 px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleFetchYouTubeMeta(youtubeUrl)}
                    className="px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 whitespace-nowrap"
                  >
                    Carregar Vídeo
                  </button>
                </div>
              </div>

              {/* Preview Player of the YouTube Video */}
              <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-100">
                      {youtubeMeta.title}
                    </span>
                    <span className="text-slate-400 ml-2">
                      · Canal: {youtubeMeta.authorName} ({youtubeMeta.videoId})
                    </span>
                  </div>
                </div>

                <div className="aspect-video w-full rounded overflow-hidden border border-slate-800 bg-black">
                  <iframe
                    src={`https://www.youtube.com/embed/${youtubeMeta.videoId}?autoplay=0&loop=1&playlist=${youtubeMeta.videoId}&rel=0`}
                    title={youtubeMeta.title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>

                {/* Direct Server-Side Streaming Action Box (No Screen Capture!) */}
                <div className="p-4 bg-emerald-950/30 border border-emerald-800/60 rounded-lg space-y-3">
                  <div className="flex items-start gap-2.5">
                    <Radio className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-semibold text-emerald-200">
                        Transmissão Autônoma Direta na Nuvem (100% no Servidor)
                      </h4>
                      <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                        O servidor busca o vídeo <strong>"{youtubeMeta.title}"</strong> diretamente do YouTube e o transmite para a sua chave de Live via conexão segura RTMPS.
                      </p>
                      <ul className="mt-2 space-y-1 text-[11px] text-emerald-300">
                        <li className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <strong>NÃO captura sua tela nem usa seu microfone.</strong>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <strong>Transmite o vídeo puro diretamente do YouTube com áudio original.</strong>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <strong>Você pode fechar esta aba ou desligar o computador imediatamente.</strong>
                        </li>
                      </ul>
                    </div>
                  </div>

                  {isCloudRunning ? (
                    <button
                      type="button"
                      onClick={handleStopAutonomousStream}
                      className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors flex items-center justify-center gap-2"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      Parar Transmissão no Servidor
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStartAutonomousStream}
                      className="w-full py-3 px-4 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30"
                    >
                      <Radio className="w-4 h-4" />
                      Iniciar Transmissão deste Vídeo do YouTube para a Live
                    </button>
                  )}
                </div>

                {/* 24/7 Stability Recommendation Card */}
                <div className="p-3 bg-amber-950/20 border border-amber-800/50 rounded-lg text-[11px] text-amber-200/90 space-y-1.5">
                  <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <span>💡</span> Dica para Transmissão 24/7 sem Quedas:
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    O YouTube frequentemente ativa proteções anti-bot em conexões de servidores em nuvem. Para uma transmissão com <strong>100% de estabilidade 24 horas por dia</strong> que nunca depende de espelhos externos:
                    baixe o arquivo (.MP4) do seu vídeo no <strong>YouTube Studio</strong> e envie na aba ao lado <strong>Vídeo Enviado (.MP4)</strong>. Ele fica salvo no disco do servidor e roda em repetição infinita perfeita!
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelectedSourceMode('uploaded-file')}
                    className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-semibold underline underline-offset-2"
                  >
                    Ir para a aba Vídeo Enviado (.MP4) &rarr;
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Source Mode Details */}
          {selectedSourceMode === 'uploaded-file' && (
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Arquivos de Vídeo Hospedados no Servidor (Suporta 1 GB+ em Blocos)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Transferência fatiada em blocos de 8 MB sem limite de tamanho
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleUploadToServer(file);
                      e.target.value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {uploading
                    ? `Enviando (${uploadProgressPct}%)`
                    : 'Enviar Vídeo (.MP4) para o Servidor'}
                </button>
              </div>

              {uploading && (
                <div className="space-y-1.5 bg-[#0B0F17] p-3 rounded border border-slate-800">
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-300">
                    <span className="truncate pr-2">{uploadStatsLabel}</span>
                    <span className="text-blue-400 font-semibold">
                      {uploadProgressPct}%
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-900 rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-transform duration-150 origin-left"
                      style={{
                        transform: `scaleX(${Math.max(0.02, uploadProgressPct / 100)})`,
                      }}
                    />
                  </div>
                </div>
              )}

              {uploadMessage && (
                <div className="text-xs text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  {uploadMessage}
                </div>
              )}

              {/* Cloud-to-Cloud Google Drive Import Section */}
              <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <span className="text-amber-400">⚡</span>
                  <span>Ou importe direto do Google Drive (sem gastar sua internet ou baixar no PC):</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={driveImportUrl}
                    onChange={(e) => setDriveImportUrl(e.target.value)}
                    placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-[#111827] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    disabled={driveImporting || !driveImportUrl.trim()}
                    onClick={() => handleImportDrive()}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded whitespace-nowrap flex items-center gap-1.5 shadow"
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    {driveImporting ? 'Importando...' : 'Importar da Nuvem'}
                  </button>
                </div>
                {driveImportMsg && (
                  <div className="text-[11px] text-emerald-300 font-medium">
                    {driveImportMsg}
                  </div>
                )}
              </div>

              {serverVideos.length === 0 ? (
                <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded text-center text-xs text-slate-400">
                  Nenhum vídeo salvo no servidor ainda. Clique em <strong>Enviar Vídeo para o Servidor</strong> acima.
                </div>
              ) : (
                <div className="space-y-2">
                  {serverVideos.map((v) => (
                    <div
                      key={v.id}
                      onClick={() => setSelectedVideoId(v.id)}
                      className={`p-3 rounded border flex items-center justify-between cursor-pointer transition-colors ${
                        selectedVideoId === v.id
                          ? 'bg-blue-950/30 border-blue-500 text-slate-100'
                          : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="truncate pr-3">
                        <div className="text-xs font-medium truncate">
                          {v.originalName}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400">
                          {(v.sizeBytes / (1024 * 1024)).toFixed(2)} MB · Salvo no servidor
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            setSelectedSourceMode('uploaded-file');
                            setSelectedVideoId(v.id);
                            setActionError('');
                            const res = await fetch('/api/cloud-stream/start', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                mode: rtmpConfig.mode,
                                sourceMode: 'uploaded-file',
                                videoId: v.id,
                                remoteUrl,
                                rtmpUrl: rtmpConfig.ingestServerUrl,
                                streamKey: rtmpConfig.streamKey,
                                loopInfinite,
                                resolution: rtmpConfig.resolution,
                                fps: rtmpConfig.fps,
                                videoBitrateKbps: rtmpConfig.videoBitrateKbps,
                                audioBitrateKbps: rtmpConfig.audioBitrateKbps,
                                forceKeyframes,
                              }),
                            });
                            const d = await safeJson(res);
                            if (!res.ok || !d.success) {
                              setActionError(d.message || 'Falha ao iniciar vídeo.');
                            } else {
                              setServerState(d.state);
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 rounded hover:bg-red-500 transition-colors whitespace-nowrap"
                        >
                          Transmitir Este Vídeo
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteServerVideo(v.id);
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-400"
                          title="Apagar do servidor"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedSourceMode === 'remote-url' && (
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-200">
                  URL do Vídeo (Google Drive, Dropbox ou Link Direto .MP4)
                </label>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Suporta links de compartilhamento do <strong>Google Drive</strong>, <strong>Dropbox</strong> ou qualquer URL direta de vídeo <code>.mp4</code>.
                </p>
              </div>

              <div className="flex gap-2">
                <input
                  type="url"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/SEU_ID/view?usp=sharing"
                  className="flex-1 px-3.5 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  disabled={driveImporting || !remoteUrl.trim()}
                  onClick={() => handleImportDrive(remoteUrl)}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded whitespace-nowrap flex items-center gap-1.5 shadow"
                  title="Baixa da nuvem para o disco do servidor em segundos"
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  {driveImporting ? 'Baixando...' : 'Salvar no Servidor'}
                </button>
              </div>

              {driveImportMsg && (
                <div className="text-[11px] text-emerald-300 font-medium">
                  {driveImportMsg}
                </div>
              )}

              <div className="p-3 bg-blue-950/20 border border-blue-800/40 rounded text-[11px] text-slate-300 space-y-2">
                <div className="font-semibold text-blue-300 flex items-center gap-1.5">
                  <span>📌</span> Como usar pelo Google Drive com 100% de sucesso:
                </div>
                <ol className="list-decimal list-inside space-y-1 text-slate-300 text-[11px] leading-relaxed">
                  <li>Envie o seu vídeo para o seu <strong>Google Drive</strong>.</li>
                  <li>Clique com o botão direito no arquivo &rarr; <strong>Compartilhar</strong> &rarr; <strong>Compartilhar</strong>.</li>
                  <li>Em <em>Acesso geral</em>, altere de "Restrito" para <strong>"Qualquer pessoa com o link"</strong>.</li>
                  <li>Copie o link gerado e cole no campo acima!</li>
                </ol>
                <div className="p-2 bg-emerald-950/30 border border-emerald-800/40 rounded text-emerald-300 text-[11px] leading-relaxed">
                  💡 <strong>Vantagem:</strong> Você pode clicar em <strong>"Salvar no Servidor"</strong>. O servidor puxa o vídeo do Google Drive diretamente nos data centers em alta velocidade (sem gastar seus dados de internet) e armazena para a live rodar 24/7 sem nunca travar!
                </div>
              </div>
            </div>
          )}

          {selectedSourceMode === 'server-test-pattern' && (
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 text-xs text-slate-300 space-y-1.5">
              <div className="font-semibold text-slate-100">
                Gerador Sintético Nativo do Servidor (FFmpeg lavfi)
              </div>
              <p className="text-slate-400 leading-relaxed">
                Gera um sinal de vídeo HD com cronômetro de quadros e tom de áudio contínuo diretamente pela CPU do servidor. Perfeito para testar agora mesmo se a transmissão continua ativa no YouTube ao fechar a aba do navegador!
              </p>
            </div>
          )}

          {/* Loop 24/7 Toggle & Explanation */}
          <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <span className="text-emerald-400 font-bold">🔁</span>
                  Repetição Automática Infinita 24/7 (Loop Contínuo)
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Quando o vídeo chegar ao fim, o servidor recarrega e reinicia automaticamente
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLoopInfinite((prev) => !prev)}
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded border transition-colors ${
                  loopInfinite
                    ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300'
                    : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
              >
                {loopInfinite ? 'LOOP 24/7 ATIVO' : 'TOCAR 1 VEZ'}
              </button>
            </div>

            <div className="p-3 bg-[#0B0F17] rounded border border-slate-800 text-[11px] text-slate-300 space-y-1.5">
              <div className="font-semibold text-emerald-300 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Como funciona o macete da repetição no Modo Nuvem:
              </div>
              <p className="text-slate-400 leading-relaxed">
                Você <strong>não precisa fazer nada manualmente</strong>. O robô do servidor fica vigiando o final do vídeo. Assim que o último segundo for transmitido, ele busca novos tokens de fluxo e reinicia o vídeo em <strong>menos de 2 segundos</strong>. A janela de buffer do YouTube Live absorve esse instante e sua transmissão nunca cai!
              </p>
            </div>
          </div>
        </div>

        {/* Column 2: Destination Mode & Stream Key */}
        <div className="lg:col-span-5 space-y-5">
          <h2 className="text-base font-semibold text-slate-100">
            2. Destino YouTube Live
          </h2>

          <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Modo de Destino do Servidor
              </label>
              <select
                value={rtmpConfig.mode}
                onChange={(e) =>
                  onUpdateRtmpConfig({
                    ...rtmpConfig,
                    mode: e.target.value as 'youtube' | 'simulation',
                  })
                }
                className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
              >
                <option value="youtube">
                  YouTube Live Real (rtmp://a.rtmp.youtube.com/live2)
                </option>
                <option value="simulation">
                  Modo Teste no Servidor (Sem Chave do YouTube)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Chave de Transmissão (Stream Key) do YouTube Studio
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={rtmpConfig.streamKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    onUpdateRtmpConfig({
                      ...rtmpConfig,
                      streamKey: val,
                      mode: val.trim().length >= 4 ? 'youtube' : rtmpConfig.mode,
                    });
                  }}
                  placeholder="Cole sua chave xxxx-xxxx-xxxx-xxxx-xxxx"
                  className="w-full pl-3 pr-9 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  {showKey ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Keyframe GOP Compliance Control */}
            <div className="p-3 bg-[#0B0F17] border border-slate-700/80 rounded space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    Frames-Chave YouTube: 2,0s Fixo (GOP Estrito)
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Elimina o erro do YouTube Studio (<em>"Use frame-chave de até 4s"</em>). Emite keyframes a cada 2 segundos exatos, prevenindo travamentos e buffer.
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={forceKeyframes}
                    onChange={(e) => setForceKeyframes(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>
              <div className="text-[10px] text-emerald-400/90 font-mono">
                {forceKeyframes
                  ? '✓ ATIVO: Envio fixo de 1 keyframe a cada 2,0s (60 quadros a 30fps) sem desvio.'
                  : '⚠ DESATIVADO: Usando frames-chave originais do arquivo (pode acionar aviso de 7,9s no YouTube).'}
              </div>
            </div>

            <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded text-xs text-amber-200/90 space-y-1">
              <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                <ShieldCheck className="w-3.5 h-3.5" />
                Dica Essencial para Lives 24/7 (Acima de 24 horas):
              </div>
              <p className="text-[11px] leading-relaxed text-amber-200/80">
                O YouTube reseta rotineiramente a conexão RTMP a cada 24 horas. Nosso servidor conta com o <strong>Watchdog 24/7</strong> que reconecta em 2 a 3 segundos. Para o YouTube não fechar sua live, no <strong>YouTube Studio</strong> &gt; Configurações da Transmissão, deixe <u>DESMARCADA</u> a opção <strong>"Ativar interrupção automática"</strong>!
              </p>
            </div>

            <div className="pt-2 border-t border-slate-800 text-xs text-slate-400 space-y-1.5 leading-relaxed">
              <div className="font-semibold text-slate-200">
                Como confirmar que funciona sem o PC:
              </div>
              <p>
                1. Clique em <strong>Iniciar Transmissão no Servidor</strong> acima.
              </p>
              <p>
                2. Veja o contador de quadros subir no console abaixo.
              </p>
              <p>
                3. <strong>Feche esta aba do navegador</strong> (ou abra o link do app no seu celular) — você verá que o contador de tempo e quadros continuou rodando sozinho no servidor!
              </p>
            </div>
          </div>

          {/* Built-in Auto-Ping Anti-Hibernation Watchdog Card */}
          <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-100">
                  3. Motor Anti-Hibernação (Auto-Ping no Próprio Site)
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  O servidor dispara requisições automáticas para si mesmo em segundo plano para manter o contêiner acordado
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const nextEnabled = !(keepAlive?.enabled ?? true);
                  const res = await fetch('/api/keepalive/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: nextEnabled }),
                  });
                  const d = await res.json();
                  if (d.keepAlive) setKeepAlive(d.keepAlive);
                }}
                className={`px-3 py-1.5 text-xs font-mono font-semibold rounded border transition-colors whitespace-nowrap ${
                  keepAlive?.enabled ?? true
                    ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300'
                    : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
              >
                {keepAlive?.enabled ?? true ? 'AUTO-PING ATIVO' : 'DESATIVADO'}
              </button>
            </div>

            {keepAlive && (
              <div className="bg-[#0B0F17] border border-slate-800 rounded p-3 space-y-1.5 text-xs font-mono tabular-nums">
                <div className="flex items-center justify-between text-slate-300">
                  <span>Pings Enviados pelo Servidor:</span>
                  <strong className="text-emerald-400">
                    {keepAlive.totalPingsSent} pings
                  </strong>
                </div>
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>Último Disparo:</span>
                  <span>
                    {keepAlive.lastPingAt || '--:--:--'} ({keepAlive.lastPingLatencyMs} ms)
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  Status: {keepAlive.lastPingStatus}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">Intervalo:</span>
                <select
                  value={keepAlive?.intervalSeconds || 45}
                  onChange={async (e) => {
                    const sec = Number(e.target.value);
                    const res = await fetch('/api/keepalive/config', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ intervalSeconds: sec }),
                    });
                    const d = await res.json();
                    if (d.keepAlive) setKeepAlive(d.keepAlive);
                  }}
                  className="px-2 py-1 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-200"
                >
                  <option value={25}>A cada 25s</option>
                  <option value={45}>A cada 45s</option>
                  <option value={60}>A cada 60s</option>
                </select>
              </div>

              <button
                type="button"
                onClick={async () => {
                  const res = await fetch('/api/keepalive/trigger', {
                    method: 'POST',
                  });
                  const d = await res.json();
                  if (d.keepAlive) setKeepAlive(d.keepAlive);
                }}
                className="px-3 py-1 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-colors whitespace-nowrap"
              >
                Testar Auto-Ping Agora
              </button>
            </div>

            {/* Browser Active Traffic Simulator & Silent Audio Keepalive */}
            <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </div>
                  <span className="text-xs font-semibold text-slate-200">
                    Simulador de Acesso da Aba (Web Worker Ativo)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={toggleAudioKeepalive}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded flex items-center gap-1.5 transition-colors ${
                    audioKeepAliveActive
                      ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                  }`}
                  title="Impede o Chrome e o celular de congelarem esta aba em segundo plano"
                >
                  {audioKeepAliveActive ? (
                    <>
                      <Volume2 className="w-3 h-3 text-emerald-400 animate-pulse" />
                      Anti-Suspensão de Aba: ATIVADO
                    </>
                  ) : (
                    <>
                      <VolumeX className="w-3 h-3 text-slate-400" />
                      Ativar Anti-Suspensão de Aba
                    </>
                  )}
                </button>
              </div>

              <div className="p-2.5 bg-[#0B0F17] border border-slate-800 rounded flex items-center justify-between text-[11px] font-mono text-slate-300">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-emerald-400" />
                  <span>Requisições simuladas do navegador:</span>
                </div>
                <strong className="text-emerald-400 tabular-nums">
                  {simulatedPingCount} acessos
                </strong>
              </div>

              <p className="text-[10px] text-slate-400 leading-relaxed">
                💡 <strong>Como deixar o servidor acordado aqui:</strong> Basta deixar esta aba aberta (pode ser minimizada no computador ou em segundo plano no celular/tablet conectado no Wi-Fi). O Web Worker continua enviando requisições contínuas para o Google Cloud Run não hibernar!
              </p>
            </div>
          </div>

          {/* Production 24/7 Deployment Card: Netlify vs Render vs Railway vs VPS */}
          <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-blue-400" />
                  4. Hospedagem 24/7 Externa (Netlify, Render, Railway ou VPS)
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Onde hospedar este sistema para rodar 24 horas por dia sem cair
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeployGuide((prev) => !prev)}
                className="px-2.5 py-1 text-xs font-semibold text-blue-400 bg-blue-950/40 border border-blue-800 rounded hover:bg-blue-900/50 transition-colors whitespace-nowrap"
              >
                {showDeployGuide ? 'Ocultar Guia' : 'Ver Guia Completo'}
              </button>
            </div>

            {/* Quick summary badges */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-[#0B0F17] border border-red-900/40 rounded space-y-0.5">
                <div className="font-semibold text-red-400 flex items-center gap-1">
                  ❌ Netlify / Vercel
                </div>
                <div className="text-[11px] text-slate-400 leading-tight">
                  Incompatível. Timeout estrito de 10s a 26s. Não roda FFmpeg.
                </div>
              </div>

              <div className="p-2.5 bg-[#0B0F17] border border-amber-900/40 rounded space-y-0.5">
                <div className="font-semibold text-amber-400 flex items-center gap-1">
                  ⚠️ Render (Plano Free)
                </div>
                <div className="text-[11px] text-slate-400 leading-tight">
                  Dorme após 15 min. Só fica 24/7 ativo no plano pago ($7/mês).
                </div>
              </div>

              <div className="p-2.5 bg-[#0B0F17] border border-emerald-900/40 rounded space-y-0.5">
                <div className="font-semibold text-emerald-400 flex items-center gap-1">
                  ✅ Railway.app
                </div>
                <div className="text-[11px] text-slate-400 leading-tight">
                  Fácil. Lê o Dockerfile pronto e não desliga (~$5/mês).
                </div>
              </div>

              <div className="p-2.5 bg-[#0B0F17] border border-blue-900/40 rounded space-y-0.5">
                <div className="font-semibold text-blue-400 flex items-center gap-1">
                  🏆 VPS Linux (Dedicada)
                </div>
                <div className="text-[11px] text-slate-400 leading-tight">
                  A melhor de todas (Hetzner, DigitalOcean, Oracle Free). Nunca cai ($3-5/mês).
                </div>
              </div>
            </div>

            {showDeployGuide && (
              <div className="pt-2 border-t border-slate-800 space-y-3 text-xs text-slate-300">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-100">
                    Por que a live caiu aos 54 minutos aqui no AI Studio?
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Este ambiente do AI Studio Build roda em contêineres de sandbox de teste no Google Cloud Run. O Cloud Run tem um limite de requisição e ciclo de instâncias de ~60 minutos. Quando você fecha a aba do navegador, a sessão de desenvolvimento é reciclada pelo Google Cloud.
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="font-semibold text-slate-100">
                    Como rodar 24/7 definitivo no Railway ou Render:
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Já criamos o arquivo <code>Dockerfile</code> na raiz do projeto. Basta subir para o seu GitHub e conectar no <strong>Railway.app</strong> ou <strong>Render</strong> (Web Service).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-100">
                    Como rodar em uma VPS Linux com Docker:
                  </div>
                  <pre className="p-2.5 bg-[#0B0F17] border border-slate-800 rounded font-mono text-[11px] text-emerald-400 overflow-x-auto select-all">
{`docker run -d --restart always -p 80:3000 --name live247 $(docker build -q .)`}
                  </pre>
                  <p className="text-[10px] text-slate-400">
                    Com a flag <code>--restart always</code>, a live nunca para e volta sozinha se a VPS reiniciar!
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Server Autonomous FFmpeg Console Output */}
      <div className="mt-8 pt-8 border-t border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            Console do Processo FFmpeg Autônomo (Rodando em Background no Servidor)
          </h2>
          <button
            type="button"
            onClick={fetchCloudStatus}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Atualizar Agora
          </button>
        </div>

        <div className="bg-[#070A10] border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-300 h-48 overflow-y-auto space-y-1">
          {!serverState || serverState.logs.length === 0 ? (
            <div className="text-slate-500">
              Nenhuma transmissão autônoma iniciada ainda. Clique em "Iniciar Transmissão no Servidor" para rodar o FFmpeg diretamente na nuvem.
            </div>
          ) : (
            serverState.logs.map((line, idx) => (
              <div
                key={idx}
                className={
                  line.toLowerCase().includes('error') ||
                  line.toLowerCase().includes('failed')
                    ? 'text-red-400'
                    : line.includes('frame=')
                    ? 'text-emerald-400'
                    : 'text-slate-300'
                }
              >
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
