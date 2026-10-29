import React, { useState } from 'react';
import { Copy, Check, Layers, Radio, Cpu, ArrowRight } from 'lucide-react';

interface ArchitectureGuideViewProps {
  onReturnToStudio: () => void;
  onOpenRtmpSettings: () => void;
}

export const ArchitectureGuideView: React.FC<ArchitectureGuideViewProps> = ({
  onReturnToStudio,
  onOpenRtmpSettings,
}) => {
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);

  const ffmpegCommandSnippet = `ffmpeg -hide_banner -loglevel info \\
  -i pipe:0 \\
  -c:v libx264 -preset veryfast -tune zerolatency \\
  -pix_fmt yuv420p -r 30 -g 60 \\
  -b:v 4500k -maxrate 4500k -bufsize 9000k \\
  -c:a aac -b:a 128k -ar 44100 \\
  -f flv rtmp://a.rtmp.youtube.com/live2/SUA_CHAVE_DE_TRANSMISSAO`;

  const browserCaptureSnippet = `// 1. Captura os quadros do Canvas (vídeos + webcam + tarjas) a 30 ou 60 FPS
const canvasStream = programCanvas.captureStream(30);

// 2. Combina com a saída do Mixer Web Audio (áudio dos vídeos MP4 + microfone)
const combinedStream = new MediaStream([
  ...canvasStream.getVideoTracks(),
  ...audioDestination.stream.getAudioTracks(),
]);

// 3. Empacota em tempo real com MediaRecorder e transmite via WebSocket para o FFmpeg
const recorder = new MediaRecorder(combinedStream, {
  mimeType: 'video/webm;codecs=h264,opus',
  videoBitsPerSecond: 4500000,
});

recorder.ondataavailable = (event) => {
  if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
    ws.send(event.data); // Enviado ao backend Node.js -> stdin do FFmpeg -> YouTube RTMP
  }
};
recorder.start(250); // Fatias de 250ms de baixa latência`;

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedBlock(id);
    setTimeout(() => setCopiedBlock(null), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 tracking-tight">
            Como Funciona o OBS Studio no Navegador para YouTube Live
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Entenda como este estúdio web compõe vídeos gravados, camadas e áudio no navegador e realiza o envio em tempo real para o YouTube via protocolo RTMP.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenRtmpSettings}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors whitespace-nowrap"
          >
            Configurar Chave do YouTube
          </button>
          <button
            type="button"
            onClick={onReturnToStudio}
            className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Voltar ao Estúdio
          </button>
        </div>
      </div>

      {/* 3-Stage Pipeline Explanation */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-[#111827] border border-slate-800 rounded-lg p-5">
          <div className="text-xs font-mono text-blue-400 mb-2">01. COMPOSIÇÃO NO NAVEGADOR</div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400" />
            HTML5 Canvas + Web Audio
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed mt-2.5">
            O navegador carrega seus arquivos <code className="font-mono text-slate-100">.MP4</code> / <code className="font-mono text-slate-100">.WebM</code> locais, captura sua webcam ou tela e desenha todas as camadas em um único quadro de vídeo de alta definição (<code className="font-mono text-slate-100">1920x1080</code> ou <code className="font-mono text-slate-100">1280x720</code>) enquanto o <code className="font-mono text-slate-100">AudioContext</code> soma os canais de áudio.
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-lg p-5">
          <div className="text-xs font-mono text-blue-400 mb-2">02. PONTE DE BAIXA LATÊNCIA</div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-400" />
            MediaRecorder &rarr; WebSocket
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed mt-2.5">
            Por segurança, navegadores web não abrem sockets TCP <code className="font-mono text-slate-100">rtmp://</code> diretamente. Por isso, o estúdio extrai o fluxo com <code className="font-mono text-slate-100">canvas.captureStream()</code> e envia blocos binários contínuos a cada <code className="font-mono text-slate-100">250ms</code> via WebSocket para o nosso servidor Node.js.
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-lg p-5">
          <div className="text-xs font-mono text-blue-400 mb-2">03. INGESTÃO YOUTUBE LIVE</div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Radio className="w-4 h-4 text-red-400" />
            FFmpeg Relay &rarr; RTMP
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed mt-2.5">
            O servidor backend (<code className="font-mono text-slate-100">server.ts</code>) recebe o fluxo WebSocket na entrada padrão (<code className="font-mono text-slate-100">pipe:0</code>) do <strong>FFmpeg</strong>, codifica em <code className="font-mono text-slate-100">H.264 + AAC</code> no formato <code className="font-mono text-slate-100">FLV</code> e empurra diretamente para <code className="font-mono text-slate-100">rtmp://a.rtmp.youtube.com/live2</code>.
          </p>
        </div>
      </div>

      {/* Code Inspection Blocks */}
      <div className="mt-8 space-y-6">
        <div className="bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between bg-[#0E1420]">
            <div>
              <span className="text-xs font-semibold text-slate-200">
                1. Captura do Monitor Composto no Frontend (Executando neste App)
              </span>
              <span className="text-xs text-slate-500 ml-2 font-mono">
                · HTMLCanvasElement.captureStream + MediaRecorder
              </span>
            </div>
            <button
              type="button"
              onClick={() => copyText('browser', browserCaptureSnippet)}
              className="px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 flex items-center gap-1.5"
            >
              {copiedBlock === 'browser' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copiar Código
                </>
              )}
            </button>
          </div>
          <pre className="p-5 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
            <code>{browserCaptureSnippet}</code>
          </pre>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between bg-[#0E1420]">
            <div>
              <span className="text-xs font-semibold text-slate-200">
                2. Comando FFmpeg Executado pelo Servidor Node.js (server.ts)
              </span>
              <span className="text-xs text-slate-500 ml-2 font-mono">
                · H.264 CBR · Keyframe 2s · Áudio AAC 44.1 kHz
              </span>
            </div>
            <button
              type="button"
              onClick={() => copyText('ffmpeg', ffmpegCommandSnippet)}
              className="px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 flex items-center gap-1.5"
            >
              {copiedBlock === 'ffmpeg' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copiar Comando
                </>
              )}
            </button>
          </div>
          <pre className="p-5 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
            <code>{ffmpegCommandSnippet}</code>
          </pre>
        </div>
      </div>

      {/* Action Callout */}
      <div className="mt-8 bg-[#111827] border border-slate-800 rounded-lg p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Pronto para testar com seus próprios vídeos?
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Você pode carregar qualquer vídeo .MP4 do seu computador agora mesmo, montar sua cena com textos e testar a transmissão ou gravar o resultado localmente.
          </p>
        </div>
        <button
          type="button"
          onClick={onReturnToStudio}
          className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2 whitespace-nowrap self-start sm:self-auto"
        >
          Abrir Mesa de Corte do Estúdio
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
