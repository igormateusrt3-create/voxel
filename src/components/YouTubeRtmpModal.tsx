import React, { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Server,
  Sliders,
  Terminal,
  RefreshCw,
} from 'lucide-react';
import { YouTubeRtmpConfig, StreamStats } from '../types/studio';

interface YouTubeRtmpModalProps {
  config: YouTubeRtmpConfig;
  onChange: (updated: YouTubeRtmpConfig) => void;
  onStartStream: () => void;
  isStreaming: boolean;
  streamStats: StreamStats;
  ffmpegLogs: string[];
  onClose?: () => void;
}

interface ServerCapabilities {
  ffmpegAvailable: boolean;
  ffmpegVersion: string;
  youtubeIngestReachable: boolean;
  youtubeHost: string;
  youtubeLatencyMs: number;
  youtubeError: string | null;
}

export const YouTubeRtmpModal: React.FC<YouTubeRtmpModalProps> = ({
  config,
  onChange,
  onStartStream,
  isStreaming,
  streamStats,
  ffmpegLogs,
  onClose,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  const [loadingCaps, setLoadingCaps] = useState(false);

  const [validationState, setValidationState] = useState<{
    status: 'idle' | 'checking' | 'valid' | 'invalid';
    message: string;
    maskedTarget?: string;
    latencyMs?: number;
  }>({ status: 'idle', message: '' });

  const fetchServerCapabilities = async () => {
    setLoadingCaps(true);
    try {
      const res = await fetch('/api/rtmp/capabilities');
      if (res.ok) {
        const data = await res.json();
        setCapabilities(data);
      }
    } catch {
      // ignore fetch error
    } finally {
      setLoadingCaps(false);
    }
  };

  useEffect(() => {
    fetchServerCapabilities();
  }, []);

  const handleValidate = async () => {
    setValidationState({
      status: 'checking',
      message: 'Testando socket TCP na porta 1935 do YouTube e validando codificador FFmpeg...',
    });
    try {
      const response = await fetch('/api/rtmp/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: config.mode,
          rtmpUrl: config.ingestServerUrl,
          streamKey: config.streamKey,
          fps: config.fps,
          videoBitrateKbps: config.videoBitrateKbps,
          audioBitrateKbps: config.audioBitrateKbps,
          resolution: config.resolution,
        }),
      });
      const data = await response.json();
      if (response.ok && data.valid) {
        setValidationState({
          status: 'valid',
          message: data.message,
          maskedTarget: data.maskedTarget,
          latencyMs: data.latencyMs,
        });
      } else {
        setValidationState({
          status: 'invalid',
          message: data.message || 'Configuração inválida.',
        });
      }
    } catch {
      setValidationState({
        status: 'invalid',
        message: 'Não foi possível contatar o servidor local de validação RTMP.',
      });
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 tracking-tight">
            Transmissão Real para o YouTube Live (RTMP + FFmpeg)
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            O servidor possui um binário real do FFmpeg instalado e conexão TCP direta com a porta 1935 do YouTube Studio.
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap self-start"
          >
            Voltar ao Monitor do Estúdio
          </button>
        )}
      </div>

      {/* Real-Time Server & YouTube Ingest Reachability Verification Bar */}
      <div className="mt-6 bg-[#111827] border border-slate-800 rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Diagnóstico Real do Servidor de Transmissão
          </div>
          {capabilities ? (
            <div className="text-xs text-slate-400 font-mono tabular-nums">
              <span>Motor: {capabilities.ffmpegVersion}</span>
              <span className="mx-2">·</span>
              <span>
                Ingestão YouTube ({capabilities.youtubeHost}):{' '}
                <strong
                  className={
                    capabilities.youtubeIngestReachable
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }
                >
                  {capabilities.youtubeIngestReachable
                    ? `CONECTADO (Latência TCP: ${capabilities.youtubeLatencyMs} ms)`
                    : 'Verifique firewall'}
                </strong>
              </span>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              Verificando binário FFmpeg e conectividade com a.rtmp.youtube.com:1935...
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={fetchServerCapabilities}
          disabled={loadingCaps}
          className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#0B0F17] border border-slate-700 rounded hover:bg-slate-800 flex items-center gap-1.5 self-start md:self-auto whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingCaps ? 'animate-spin' : ''}`} />
          Testar Ping YouTube (Porta 1935)
        </button>
      </div>

      {/* Mode Selection Segmented Control */}
      <div className="mt-6">
        <label className="block text-xs font-medium text-slate-400 mb-2">
          Selecione o Modo de Envio
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-1.5 bg-[#111827] border border-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => {
              onChange({ ...config, mode: 'youtube' });
              setValidationState({ status: 'idle', message: '' });
            }}
            className={`px-4 py-3 text-left rounded-md transition-colors ${
              config.mode === 'youtube'
                ? 'bg-red-600 text-white'
                : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <div className="text-sm font-semibold">
              1. Transmissão Real — Entrar Ao Vivo no YouTube Live
            </div>
            <div
              className={`text-xs mt-0.5 ${
                config.mode === 'youtube' ? 'text-red-100' : 'text-slate-400'
              }`}
            >
              Envia o vídeo do estúdio via RTMP para rtmp://a.rtmp.youtube.com/live2 usando sua Chave
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              onChange({ ...config, mode: 'simulation' });
              setValidationState({ status: 'idle', message: '' });
            }}
            className={`px-4 py-3 text-left rounded-md transition-colors ${
              config.mode === 'simulation'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            <div className="text-sm font-semibold">
              2. Modo Teste — Validar Codificador FFmpeg Sem Chave
            </div>
            <div
              className={`text-xs mt-0.5 ${
                config.mode === 'simulation' ? 'text-blue-100' : 'text-slate-400'
              }`}
            >
              Executa o FFmpeg real no servidor e mostra a taxa de quadros sem publicar no canal
            </div>
          </button>
        </div>
      </div>

      {/* Ingest Server & Stream Key Section */}
      <div className="mt-8 pt-8 border-t border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-5">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-400" />
            Credenciais de Ingestão do YouTube Studio
          </h2>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              URL do Servidor RTMP (Padrão Oficial do YouTube)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={config.ingestServerUrl}
                onChange={(e) =>
                  onChange({ ...config, ingestServerUrl: e.target.value })
                }
                placeholder="rtmp://a.rtmp.youtube.com/live2"
                className="w-full px-3.5 py-2 text-sm font-mono bg-[#111827] border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
              />
              <select
                value={
                  config.ingestServerUrl === 'rtmp://a.rtmp.youtube.com/live2'
                    ? 'yt-primary'
                    : config.ingestServerUrl === 'rtmp://b.rtmp.youtube.com/live2?backup=1'
                    ? 'yt-backup'
                    : 'custom'
                }
                onChange={(e) => {
                  if (e.target.value === 'yt-primary') {
                    onChange({
                      ...config,
                      ingestServerUrl: 'rtmp://a.rtmp.youtube.com/live2',
                    });
                  } else if (e.target.value === 'yt-backup') {
                    onChange({
                      ...config,
                      ingestServerUrl: 'rtmp://b.rtmp.youtube.com/live2?backup=1',
                    });
                  }
                }}
                className="px-3 py-2 text-xs bg-[#111827] border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:border-blue-500"
              >
                <option value="yt-primary">YouTube Primário</option>
                <option value="yt-backup">YouTube Backup</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Chave de Transmissão (Stream Key) do seu Canal
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={config.streamKey}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange({
                    ...config,
                    streamKey: val,
                    // Automatically switch to real YouTube mode as soon as the user pastes a key!
                    mode: val.trim().length >= 4 ? 'youtube' : config.mode,
                  });
                }}
                placeholder="Cole aqui sua chave (ex: abcd-1234-efgh-5678-ijkl)"
                className="w-full pl-3.5 pr-10 py-2.5 text-sm font-mono bg-[#111827] border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                title={showKey ? 'Ocultar chave' : 'Mostrar chave'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              Ao colar sua chave acima, o sistema seleciona automaticamente o modo <strong>Transmissão Real — YouTube Live</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleValidate}
              className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              Testar Conexão & Validar Chave
            </button>

            <button
              type="button"
              onClick={onStartStream}
              disabled={
                !isStreaming &&
                config.mode === 'youtube' &&
                !config.streamKey.trim()
              }
              className={`px-5 py-2 text-xs font-semibold text-white rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                isStreaming
                  ? 'bg-amber-600 hover:bg-amber-500'
                  : 'bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:pointer-events-none'
              }`}
            >
              <Radio className="w-4 h-4" />
              {isStreaming
                ? 'Encerrar Transmissão Ativa'
                : config.mode === 'youtube'
                ? 'Transmitir Ao Vivo para o YouTube Agora'
                : 'Iniciar Teste Real do Codificador FFmpeg'}
            </button>
          </div>

          {validationState.status !== 'idle' && (
            <div
              className={`p-3.5 rounded-lg border text-xs flex items-start gap-2.5 ${
                validationState.status === 'valid'
                  ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-200'
                  : validationState.status === 'invalid'
                  ? 'bg-red-950/30 border-red-800/70 text-red-200'
                  : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              {validationState.status === 'valid' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <div className="font-medium">{validationState.message}</div>
                {validationState.maskedTarget && (
                  <div className="font-mono text-[11px] opacity-80">
                    Destino: {validationState.maskedTarget}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Step-by-step instructions to verify on YouTube Studio */}
        <div className="lg:col-span-5 bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-100">
            Como fazer o teste real no seu canal agora:
          </h3>
          <ol className="space-y-3 text-xs text-slate-300 leading-relaxed">
            <li className="flex gap-2.5">
              <span className="font-mono font-semibold text-blue-400 shrink-0">01.</span>
              <span>
                Abra o <strong>YouTube Studio</strong> (studio.youtube.com) &rarr; clique em{' '}
                <strong>Criar &rarr; Transmitir ao vivo</strong>. (Você pode configurar a visibilidade como <strong>Não listado</strong> ou <strong>Privado</strong> para fazer um teste fechado!).
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono font-semibold text-blue-400 shrink-0">02.</span>
              <span>
                Copie a <strong>Chave de transmissão (Stream Key)</strong> exibida no painel do YouTube e cole no campo ao lado.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono font-semibold text-blue-400 shrink-0">03.</span>
              <span>
                Clique em <strong>Transmitir Ao Vivo para o YouTube Agora</strong>. Em cerca de 5 a 10 segundos, o indicador no YouTube Studio mudará para <strong>"Conexão Excelente"</strong> e o vídeo do nosso estúdio aparecerá lá!
              </span>
            </li>
          </ol>
        </div>
      </div>

      {/* Live FFmpeg Console Output */}
      <div className="mt-8 pt-8 border-t border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            Saída em Tempo Real do Processo FFmpeg no Servidor
          </h2>
          <span className="text-xs font-mono tabular-nums text-slate-400">
            {streamStats.isStreaming
              ? `ATIVO · ${streamStats.framesSent} quadros enviados · ${streamStats.bitrateKbps} kbps`
              : 'Aguardando início da transmissão'}
          </span>
        </div>

        <div className="bg-[#070A10] border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-300 h-44 overflow-y-auto space-y-1">
          {ffmpegLogs.length === 0 ? (
            <div className="text-slate-500">
              Clique em "Iniciar Teste Real do Codificador FFmpeg" ou "Transmitir Ao Vivo para o YouTube Agora" para visualizar os logs de codificação H.264/AAC do FFmpeg em tempo real.
            </div>
          ) : (
            ffmpegLogs.map((logLine, idx) => (
              <div
                key={idx}
                className={
                  logLine.toLowerCase().includes('error') ||
                  logLine.toLowerCase().includes('failed')
                    ? 'text-red-400'
                    : logLine.includes('frame=')
                    ? 'text-emerald-400'
                    : 'text-slate-300'
                }
              >
                {logLine}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Encoder Quality Settings */}
      <div className="mt-8 pt-8 border-t border-slate-800">
        <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2 mb-5">
          <Sliders className="w-4 h-4 text-blue-400" />
          Parâmetros de Codificação de Vídeo e Áudio (H.264 / AAC)
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
            <label className="block text-xs text-slate-400 mb-1.5">Resolução de Saída</label>
            <select
              value={config.resolution}
              onChange={(e) =>
                onChange({
                  ...config,
                  resolution: e.target.value as '1920x1080' | '1280x720',
                })
              }
              className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
            >
              <option value="1280x720">1280x720 (HD 720p)</option>
              <option value="1920x1080">1920x1080 (Full HD 1080p)</option>
            </select>
            <div className="text-[11px] text-slate-400 mt-2 font-mono tabular-nums">
              Proporção 16:9 · YUV420P
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
            <label className="block text-xs text-slate-400 mb-1.5">Taxa de Quadros (FPS)</label>
            <select
              value={config.fps}
              onChange={(e) =>
                onChange({ ...config, fps: Number(e.target.value) as 30 | 60 })
              }
              className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
            >
              <option value={30}>30 FPS (Padrão Broadcast)</option>
              <option value={60}>60 FPS (Alta Fluidez)</option>
            </select>
            <div className="text-[11px] text-slate-400 mt-2 font-mono tabular-nums">
              Keyframe (GOP): {config.fps * 2} frames (2.0s)
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
            <label className="block text-xs text-slate-400 mb-1.5">
              Bitrate de Vídeo (CBR)
            </label>
            <select
              value={config.videoBitrateKbps}
              onChange={(e) =>
                onChange({ ...config, videoBitrateKbps: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
            >
              <option value={2500}>2500 kbps (720p Econômico)</option>
              <option value={4500}>4500 kbps (720p60 / 1080p30 Ideal)</option>
              <option value={6000}>6000 kbps (1080p Alta Qualidade)</option>
              <option value={8000}>8000 kbps (1080p60 Master)</option>
            </select>
            <div className="text-[11px] text-slate-400 mt-2 font-mono tabular-nums">
              Buffer: {config.videoBitrateKbps * 2} kbps · zerolatency
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
            <label className="block text-xs text-slate-400 mb-1.5">Bitrate de Áudio AAC</label>
            <select
              value={config.audioBitrateKbps}
              onChange={(e) =>
                onChange({
                  ...config,
                  audioBitrateKbps: Number(e.target.value) as 128 | 160 | 192,
                })
              }
              className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
            >
              <option value={128}>128 kbps · 44.1 kHz Estéreo</option>
              <option value={160}>160 kbps · 44.1 kHz Estéreo</option>
              <option value={192}>192 kbps · 44.1 kHz Estéreo</option>
            </select>
            <div className="text-[11px] text-slate-400 mt-2 font-mono tabular-nums">
              Web Audio Mixer &rarr; Opus/AAC
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
