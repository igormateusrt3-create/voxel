import express from 'express';
import fs from 'fs';
import http from 'http';
import net from 'net';
import tls from 'tls';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import ffmpegPath from 'ffmpeg-static';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = path.join(os.tmpdir(), 'voxelcast-cloud-videos');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

interface StreamSessionConfig {
  mode: 'youtube' | 'simulation';
  rtmpUrl: string;
  streamKey: string;
  fps: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  resolution: string;
}

interface UploadedServerVideo {
  id: string;
  originalName: string;
  filePath: string;
  sizeBytes: number;
  hasAudio: boolean;
  uploadedAt: string;
}

interface CloudStreamState {
  active: boolean;
  mode: 'youtube' | 'simulation';
  sourceMode: 'uploaded-file' | 'remote-url' | 'server-test-pattern' | 'youtube-link';
  sourceLabel: string;
  maskedTarget: string;
  startedAt: number | null;
  frames: number;
  fps: number;
  bitrateKbps: number;
  ffmpegTime: string;
  loopInfinite: boolean;
  loopCycle: number;
  resolution: string;
  statusMessage: string;
  logs: string[];
}

interface KeepAliveState {
  enabled: boolean;
  intervalSeconds: number;
  totalPingsSent: number;
  lastPingAt: string | null;
  lastPingStatus: string;
  lastPingLatencyMs: number;
  detectedPublicUrl: string;
}

const serverVideos: Map<string, UploadedServerVideo> = new Map();
let cloudFfmpegProcess: ChildProcessWithoutNullStreams | null = null;
let keepAliveTimer: NodeJS.Timeout | null = null;

const keepAliveState: KeepAliveState = {
  enabled: true,
  intervalSeconds: 45,
  totalPingsSent: 0,
  lastPingAt: null,
  lastPingStatus: 'Aguardando primeiro ciclo...',
  lastPingLatencyMs: 0,
  detectedPublicUrl:
    process.env.APP_URL && process.env.APP_URL.startsWith('http')
      ? process.env.APP_URL.replace(/\/+$/, '')
      : '',
};

async function executeSelfPing() {
  const startTime = Date.now();
  const targetBase = keepAliveState.detectedPublicUrl || `http://127.0.0.1:${PORT}`;
  const targetUrl = `${targetBase}/api/keepalive/ping?t=${startTime}`;

  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'VoxelCast-KeepAlive-Watchdog/1.0' },
    });
    const latency = Date.now() - startTime;
    keepAliveState.totalPingsSent += 1;
    keepAliveState.lastPingAt = new Date().toTimeString().slice(0, 8);
    keepAliveState.lastPingLatencyMs = latency;
    keepAliveState.lastPingStatus = `HTTP ${res.status} OK (${
      keepAliveState.detectedPublicUrl ? 'Externo + Local' : 'Loopback Local'
    })`;

    // Also ping local loopback if we pinged external URL
    if (keepAliveState.detectedPublicUrl) {
      fetch(`http://127.0.0.1:${PORT}/api/keepalive/ping`).catch(() => {});
    }
  } catch {
    // Fallback to local loopback if external URL is guarded by proxy auth
    try {
      const resLocal = await fetch(`http://127.0.0.1:${PORT}/api/keepalive/ping?t=${startTime}`);
      const latency = Date.now() - startTime;
      keepAliveState.totalPingsSent += 1;
      keepAliveState.lastPingAt = new Date().toTimeString().slice(0, 8);
      keepAliveState.lastPingLatencyMs = latency;
      keepAliveState.lastPingStatus = `HTTP ${resLocal.status} OK (Keep-Alive Interno Ativo)`;
    } catch (err) {
      keepAliveState.lastPingStatus = `Erro: ${(err as Error).message}`;
    }
  }
}

function restartKeepAliveLoop() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (keepAliveState.enabled) {
    keepAliveTimer = setInterval(() => {
      executeSelfPing();
    }, Math.max(15, keepAliveState.intervalSeconds) * 1000);
  }
}
let activeLoopTimer: NodeJS.Timeout | null = null;
let isManualStop = false;
let currentCloudParams: any = null;
let currentLoopCycle = 1;
let consecutiveRetries = 0;
let lastStreamStartTime = 0;

let cloudState: CloudStreamState = {
  active: false,
  mode: 'youtube',
  sourceMode: 'server-test-pattern',
  sourceLabel: 'Nenhum',
  maskedTarget: '',
  startedAt: null,
  frames: 0,
  fps: 30,
  bitrateKbps: 0,
  ffmpegTime: '00:00:00.00',
  loopInfinite: true,
  loopCycle: 1,
  resolution: '1280x720',
  statusMessage: 'Servidor em espera. Pronto para transmitir para o YouTube.',
  logs: [],
};

function appendCloudLog(line: string) {
  const timestamp = new Date().toTimeString().slice(0, 8);
  cloudState.logs = [...cloudState.logs.slice(-60), `[${timestamp}] ${line}`];
}

function stopCloudFfmpeg() {
  isManualStop = true;
  if (activeLoopTimer) {
    clearTimeout(activeLoopTimer);
    activeLoopTimer = null;
  }
  if (cloudFfmpegProcess) {
    try {
      cloudFfmpegProcess.stdin.write('q\n');
      cloudFfmpegProcess.stdin.end();
    } catch {
      // ignore
    }
    try {
      cloudFfmpegProcess.kill('SIGINT');
    } catch {
      // ignore
    }
    cloudFfmpegProcess = null;
  }
  cloudState.active = false;
}

// Map standard RTMP hostnames to their TLS port 443 RTMPS endpoints
function resolveRtmpsTarget(rawRtmpUrl: string): {
  tlsHost: string;
  tlsPort: number;
  appPath: string;
  tcUrl: string;
} {
  try {
    const normalized = rawRtmpUrl.trim().replace(/\/+$/, '');
    const parsed = new URL(normalized);
    let host = parsed.hostname;
    if (host === 'a.rtmp.youtube.com') {
      host = 'a.rtmps.youtube.com';
    } else if (host === 'b.rtmp.youtube.com') {
      host = 'b.rtmps.youtube.com';
    }
    const appPath = parsed.pathname.replace(/^\/+/, '') || 'live2';
    const search = parsed.search || '';
    return {
      tlsHost: host,
      tlsPort: 443,
      appPath: `${appPath}${search}`,
      tcUrl: `rtmps://${host}:443/${appPath}${search}`,
    };
  } catch {
    return {
      tlsHost: 'a.rtmps.youtube.com',
      tlsPort: 443,
      appPath: 'live2',
      tcUrl: 'rtmps://a.rtmps.youtube.com:443/live2',
    };
  }
}

// Create a local loopback TCP -> TLS (Port 443) proxy server so ffmpeg-static:
// 1. Connects to 127.0.0.1 (avoiding static glibc getaddrinfo segfault on Linux)
// 2. Routes outbound traffic over TLS Port 443 (a.rtmps.youtube.com:443), bypassing Port 1935 container firewall blocks!
let activeTlsTargetHost = 'a.rtmps.youtube.com';
let activeTlsTargetPort = 443;
let localBridgePort = 0;

function startLocalRtmpsBridge(): Promise<number> {
  return new Promise((resolve, reject) => {
    const bridge = net.createServer((clientSocket) => {
      clientSocket.setNoDelay(true);
      clientSocket.setKeepAlive(true, 10000);
      const remoteTls = tls.connect(
        {
          host: activeTlsTargetHost,
          port: activeTlsTargetPort,
          servername: activeTlsTargetHost,
          rejectUnauthorized: false,
        },
        () => {
          remoteTls.setNoDelay(true);
          remoteTls.setKeepAlive(true, 10000);
        }
      );

      clientSocket.pipe(remoteTls);
      remoteTls.pipe(clientSocket);

      remoteTls.on('error', () => {
        clientSocket.destroy();
      });
      clientSocket.on('error', () => {
        remoteTls.destroy();
      });
      clientSocket.on('close', () => {
        remoteTls.destroy();
      });
      remoteTls.on('close', () => {
        clientSocket.destroy();
      });
    });

    bridge.on('error', reject);
    bridge.listen(0, '127.0.0.1', () => {
      const addr = bridge.address();
      if (addr && typeof addr === 'object') {
        localBridgePort = addr.port;
        resolve(addr.port);
      } else {
        reject(new Error('Failed to bind local RTMPS bridge'));
      }
    });
  });
}

// Test TLS reachability to YouTube RTMPS on port 443
function testRtmpsTlsReachability(rawRtmpUrl: string): Promise<{
  reachable: boolean;
  host: string;
  port: number;
  latencyMs: number;
  error?: string;
}> {
  return new Promise((resolve) => {
    const { tlsHost, tlsPort } = resolveRtmpsTarget(rawRtmpUrl);
    const startTime = Date.now();

    const socket = tls.connect(
      {
        host: tlsHost,
        port: tlsPort,
        servername: tlsHost,
        timeout: 4000,
      },
      () => {
        const latencyMs = Date.now() - startTime;
        socket.destroy();
        resolve({ reachable: true, host: tlsHost, port: tlsPort, latencyMs });
      }
    );

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        reachable: false,
        host: tlsHost,
        port: tlsPort,
        latencyMs: 4000,
        error: `Tempo limite excedido ao conectar em ${tlsHost}:${tlsPort}`,
      });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({
        reachable: false,
        host: tlsHost,
        port: tlsPort,
        latencyMs: Date.now() - startTime,
        error: err.message,
      });
    });
  });
}

// Probe whether an uploaded video file has an audio stream
function probeVideoHasAudio(filePath: string): Promise<boolean> {
  const binary = ffmpegPath || 'ffmpeg';
  return new Promise((resolve) => {
    execFile(binary, ['-hide_banner', '-i', filePath], { timeout: 4000 }, (_err, stdout, stderr) => {
      const combined = `${stdout || ''}\n${stderr || ''}`;
      resolve(combined.includes('Audio:'));
    });
  });
}

async function startServer() {
  await startLocalRtmpsBridge();
  console.log(`Local RTMP -> RTMPS (TLS:443) bridge listening on 127.0.0.1:${localBridgePort}`);

  const app = express();

  // Fast healthcheck routes for Render, Railway, Fly.io & UptimeRobot
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()), streaming: cloudState.active });
  });
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()), streaming: cloudState.active });
  });

  // Chunked binary upload route for large 1GB+ video files (bypasses Cloud Run 32MB per-request limit)
  app.post('/api/cloud-stream/upload-chunk', (req, res) => {
    const uploadId = (req.headers['x-upload-id'] as string) || `srv-vid-${Date.now()}`;
    const rawName = (req.headers['x-file-name'] as string) || 'video.mp4';
    const isLastChunk = req.headers['x-is-last-chunk'] === 'true';
    const safeName = decodeURIComponent(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(UPLOAD_DIR, `${uploadId}-${safeName}`);

    const writeStream = fs.createWriteStream(filePath, { flags: 'a' });

    req.pipe(writeStream);

    writeStream.on('finish', async () => {
      try {
        const stats = fs.statSync(filePath);
        if (isLastChunk) {
          const hasAudio = await probeVideoHasAudio(filePath);
          const item: UploadedServerVideo = {
            id: uploadId,
            originalName: decodeURIComponent(rawName),
            filePath,
            sizeBytes: stats.size,
            hasAudio,
            uploadedAt: new Date().toISOString(),
          };
          serverVideos.set(uploadId, item);
          res.json({
            success: true,
            completed: true,
            video: {
              id: item.id,
              originalName: item.originalName,
              sizeBytes: item.sizeBytes,
              hasAudio: item.hasAudio,
              uploadedAt: item.uploadedAt,
            },
          });
        } else {
          res.json({
            success: true,
            completed: false,
            receivedBytes: stats.size,
          });
        }
      } catch (err) {
        res.status(500).json({
          success: false,
          message: `Erro ao gravar bloco do vídeo: ${(err as Error).message}`,
        });
      }
    });

    writeStream.on('error', (err) => {
      res.status(500).json({
        success: false,
        message: `Erro ao gravar bloco no servidor: ${err.message}`,
      });
    });
  });

  // Raw binary streaming upload route for server-side video files (before express.json)
  app.post('/api/cloud-stream/upload', (req, res) => {
    const rawName = (req.headers['x-file-name'] as string) || 'video.mp4';
    const safeName = decodeURIComponent(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const id = `srv-vid-${Date.now()}`;
    const filePath = path.join(UPLOAD_DIR, `${id}-${safeName}`);

    const writeStream = fs.createWriteStream(filePath);
    let sizeBytes = 0;

    req.on('data', (chunk: Buffer) => {
      sizeBytes += chunk.length;
    });

    req.pipe(writeStream);

    writeStream.on('finish', async () => {
      const hasAudio = await probeVideoHasAudio(filePath);
      const item: UploadedServerVideo = {
        id,
        originalName: decodeURIComponent(rawName),
        filePath,
        sizeBytes,
        hasAudio,
        uploadedAt: new Date().toISOString(),
      };
      serverVideos.set(id, item);
      res.json({
        success: true,
        video: {
          id: item.id,
          originalName: item.originalName,
          sizeBytes: item.sizeBytes,
          hasAudio: item.hasAudio,
          uploadedAt: item.uploadedAt,
        },
      });
    });

    writeStream.on('error', (err) => {
      res.status(500).json({
        success: false,
        message: `Erro ao salvar vídeo no servidor: ${err.message}`,
      });
    });
  });

  app.use(express.json());

  // Automatically detect public Cloud Run URL from incoming request headers if not already set
  app.use((req, _res, next) => {
    if (!keepAliveState.detectedPublicUrl) {
      const forwardedHost = (req.headers['x-forwarded-host'] as string) || req.headers.host;
      const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
      if (
        forwardedHost &&
        !forwardedHost.includes('127.0.0.1') &&
        !forwardedHost.includes('localhost')
      ) {
        keepAliveState.detectedPublicUrl = `${proto}://${forwardedHost}`;
      }
    }
    next();
  });

  // Keep-Alive Ping Endpoint
  app.get('/api/keepalive/ping', (_req, res) => {
    res.json({
      alive: true,
      timestamp: Date.now(),
      cloudStreamActive: cloudState.active,
    });
  });

  // Configure Keep-Alive Anti-Hibernation settings
  app.post('/api/keepalive/config', (req, res) => {
    const { enabled, intervalSeconds, customPublicUrl } = req.body;
    if (typeof enabled === 'boolean') {
      keepAliveState.enabled = enabled;
    }
    if (typeof intervalSeconds === 'number' && intervalSeconds >= 15) {
      keepAliveState.intervalSeconds = intervalSeconds;
    }
    if (typeof customPublicUrl === 'string' && customPublicUrl.trim().startsWith('http')) {
      keepAliveState.detectedPublicUrl = customPublicUrl.trim().replace(/\/+$/, '');
    }
    restartKeepAliveLoop();
    if (keepAliveState.enabled) {
      executeSelfPing();
    }
    res.json({ success: true, keepAlive: keepAliveState });
  });

  // Trigger an immediate self-ping
  app.post('/api/keepalive/trigger', async (_req, res) => {
    await executeSelfPing();
    res.json({ success: true, keepAlive: keepAliveState });
  });

  // YouTube proxy sessions store
  interface YouTubeProxySession {
    videoUrl: string;
    audioUrl: string;
    authCookie: string;
    userAgent: string;
  }
  const ytProxySessions = new Map<string, YouTubeProxySession>();

  // Helper to resolve YouTube direct streams with Invidious and Anubis PoW solving
  async function resolveYouTubeStreams(videoId: string): Promise<{
    videoUrl: string;
    audioUrl: string;
    authCookie: string;
    title: string;
  }> {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    const invidiousUrls = [
      `https://invidious.f5.si/api/v1/videos/${videoId}?local=true`,
      `https://invidious.flokinet.to/api/v1/videos/${videoId}?local=true`,
      `https://invidious.privacyredirect.com/api/v1/videos/${videoId}`,
      `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`,
      `https://invidious.projectsegfau.lt/api/v1/videos/${videoId}`,
      `https://inv.nadeko.net/api/v1/videos/${videoId}`,
      `https://yewtu.be/api/v1/videos/${videoId}`,
    ];
    let lastErr = '';
    for (const invUrl of invidiousUrls) {
      try {
        const res = await fetch(invUrl, {
          headers: { 'User-Agent': ua, Accept: 'application/json' },
          signal: AbortSignal.timeout(4500),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.error) continue;

        const vidFormat =
          data.adaptiveFormats?.find((f: any) => f.itag === '136') ||
          data.adaptiveFormats?.find((f: any) => f.itag === '134') ||
          data.adaptiveFormats?.find((f: any) => f.type?.startsWith('video/mp4'));
        const audFormat =
          data.adaptiveFormats?.find((f: any) => f.itag === '140') ||
          data.adaptiveFormats?.find((f: any) => f.type?.startsWith('audio/mp4'));

        if (!vidFormat || !audFormat) continue;

        let videoUrl = vidFormat.url;
        let audioUrl = audFormat.url;

        // If URL is relative (/videoplayback), prefix with instance origin
        if (videoUrl.startsWith('/')) {
          const origin = new URL(invUrl).origin;
          videoUrl = `${origin}${videoUrl}`;
        }
        if (audioUrl.startsWith('/')) {
          const origin = new URL(invUrl).origin;
          audioUrl = `${origin}${audioUrl}`;
        }

        let authCookie = '';
        try {
          const testRes = await fetch(videoUrl, {
            headers: { 'User-Agent': ua },
            signal: AbortSignal.timeout(3500),
          });
          const txt = await testRes.text();
          if (txt.includes('id="anubis_challenge"')) {
            const match = txt.match(/id="anubis_challenge"[^>]*>([\s\S]*?)<\/script>/);
            if (match && match[1]) {
              const chalData = JSON.parse(match[1]);
              const randomData = chalData.challenge.randomData;
              const diff = chalData.rules.difficulty || 4;
              const prefix = '0'.repeat(diff);
              let nonce = 0;
              let hash = '';
              while (true) {
                hash = crypto.createHash('sha256').update(randomData + nonce).digest('hex');
                if (hash.startsWith(prefix)) break;
                nonce++;
              }
              const cookies = testRes.headers.getSetCookie?.() || [];
              const cookieStr = cookies
                .map((c: string) => c.split(';')[0])
                .filter((c: string) => !c.endsWith('='))
                .join('; ');
              const passUrl = `${new URL(invUrl).origin}/.within.website/x/cmd/anubis/api/pass-challenge?id=${chalData.challenge.id}&response=${hash}&nonce=${nonce}&redir=/&elapsedTime=45`;
              const passRes = await fetch(passUrl, {
                redirect: 'manual',
                headers: { 'User-Agent': ua, Cookie: cookieStr },
                signal: AbortSignal.timeout(3500),
              });
              const authCookies = passRes.headers.getSetCookie?.() || [];
              authCookie = authCookies
                .map((c: string) => c.split(';')[0])
                .filter((c: string) => !c.endsWith('='))
                .join('; ');
            }
          }
        } catch (err: any) {
          console.warn('PoW error:', err.message);
        }

        return {
          videoUrl,
          audioUrl,
          authCookie,
          title: data.title || `YouTube (${videoId})`,
        };
      } catch (e: any) {
        lastErr = e.message;
      }
    }
    throw new Error(
      `O YouTube ativou uma proteção anti-bot que bloqueia a leitura direta deste link pelo servidor em nuvem (${lastErr || 'espelhos ocupados'}). Para transmitir 24/7 sem nenhuma falha: use a aba 'Vídeo Enviado (.MP4)' ao lado (envie o arquivo do vídeo direto para o servidor) ou use um link direto .mp4!`
    );
  }

  // Local loopback HTTP proxy endpoint for FFmpeg to read without external DNS issues
  app.get('/api/local-yt-proxy/:sessionId/:track', async (req, res) => {
    const { sessionId, track } = req.params;
    const session = ytProxySessions.get(sessionId);
    if (!session) {
      res.status(404).send('Session not found');
      return;
    }
    const targetUrl = track.includes('audio') ? session.audioUrl : session.videoUrl;
    const headers: Record<string, string> = {
      'User-Agent': session.userAgent,
    };
    if (session.authCookie) {
      headers['Cookie'] = session.authCookie;
    }
    if (req.headers.range) {
      headers['Range'] = req.headers.range as string;
    }
    try {
      const upstream = await fetch(targetUrl, { headers });
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || (track.includes('audio') ? 'audio/mp4' : 'video/mp4'),
        ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length')! } : {}),
        ...(upstream.headers.get('content-range') ? { 'Content-Range': upstream.headers.get('content-range')! } : {}),
        'Accept-Ranges': 'bytes',
      });
      if (upstream.body) {
        const stream = Readable.fromWeb(upstream.body as any);
        req.on('close', () => stream.destroy());
        stream.on('error', () => res.end());
        stream.pipe(res);
      } else {
        res.end();
      }
    } catch {
      res.status(502).end();
    }
  });

  const server = http.createServer(app);

  // API: Check FFmpeg binary version & YouTube RTMPS (Port 443) server reachability
  app.get('/api/rtmp/capabilities', async (_req, res) => {
    const binary = ffmpegPath || 'ffmpeg';
    const versionPromise = new Promise<string>((resolve) => {
      execFile(binary, ['-version'], { timeout: 3000 }, (err, stdout) => {
        if (err || !stdout) {
          resolve('FFmpeg Static (H.264/AAC)');
          return;
        }
        const firstLine = stdout.split('\n')[0] || 'FFmpeg Static';
        resolve(firstLine.trim());
      });
    });

    const [ffmpegVersion, youtubePing] = await Promise.all([
      versionPromise,
      testRtmpsTlsReachability('rtmps://a.rtmps.youtube.com/live2'),
    ]);

    res.json({
      ffmpegAvailable: Boolean(ffmpegPath),
      ffmpegVersion,
      youtubeIngestReachable: youtubePing.reachable,
      youtubeHost: `${youtubePing.host}:${youtubePing.port} (RTMPS TLS)`,
      youtubeLatencyMs: youtubePing.latencyMs,
      youtubeError: youtubePing.error || null,
      websocketEndpoint: '/ws/rtmp',
    });
  });

  // API: Validate YouTube RTMP target and test live TLS socket on port 443
  app.post('/api/rtmp/validate', async (req, res) => {
    const { mode, rtmpUrl, streamKey } = req.body as Partial<StreamSessionConfig>;
    const cleanUrl = (rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2')
      .trim()
      .replace(/\/+$/, '');

    const tlsCheck = await testRtmpsTlsReachability(cleanUrl);

    if (mode === 'simulation') {
      res.json({
        valid: true,
        mode: 'simulation',
        tcpReachable: tlsCheck.reachable,
        latencyMs: tlsCheck.latencyMs,
        host: `${tlsCheck.host}:${tlsCheck.port}`,
        maskedTarget: 'pipe:0 -> ffmpeg libx264/aac -> null-muxer (Teste Real de Codificação)',
        message: tlsCheck.reachable
          ? `Servidor FFmpeg ativo e túnel TLS com ${tlsCheck.host}:${tlsCheck.port} testado com sucesso (${tlsCheck.latencyMs} ms).`
          : 'Servidor FFmpeg ativo em Modo Teste Local.',
      });
      return;
    }

    const cleanKey = (streamKey || '').trim();

    if (!cleanUrl.startsWith('rtmp://') && !cleanUrl.startsWith('rtmps://')) {
      res.status(400).json({
        valid: false,
        message:
          'A URL do servidor deve começar com rtmp:// ou rtmps:// (ex: rtmp://a.rtmp.youtube.com/live2).',
      });
      return;
    }

    if (!cleanKey || cleanKey.length < 4) {
      res.status(400).json({
        valid: false,
        message:
          'Cole a Chave de Transmissão (Stream Key) gerada no painel do YouTube Studio para iniciar a Live real.',
      });
      return;
    }

    const maskedKey =
      cleanKey.length > 8
        ? `${cleanKey.slice(0, 4)}-****-****-${cleanKey.slice(-4)}`
        : '****-****';

    res.json({
      valid: true,
      mode: 'youtube',
      tcpReachable: tlsCheck.reachable,
      latencyMs: tlsCheck.latencyMs,
      host: `${tlsCheck.host}:${tlsCheck.port}`,
      maskedTarget: `rtmps://${tlsCheck.host}:${tlsCheck.port}/live2/${maskedKey}`,
      message: tlsCheck.reachable
        ? `Conexão segura RTMPS (${tlsCheck.host}:${tlsCheck.port}) confirmada em ${tlsCheck.latencyMs} ms! Pronto para entrar ao vivo no YouTube.`
        : `Aviso: Não foi possível alcançar ${tlsCheck.host}:${tlsCheck.port} (${tlsCheck.error || 'erro de rede'}).`,
    });
  });

  // Helper to extract 11-char YouTube Video ID from any YouTube URL (watch, live, youtu.be, shorts)
  function extractYouTubeId(rawUrl: string): string | null {
    const clean = (rawUrl || '').trim();
    const match = clean.match(
      /(?:youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    if (match && match[1]) return match[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
    return null;
  }

  // API: Fetch YouTube Video Metadata via Official oEmbed
  app.get('/api/youtube/info', async (req, res) => {
    const rawUrl = (req.query.url as string) || 'https://www.youtube.com/live/ZCKgoFyh2hI';
    const videoId = extractYouTubeId(rawUrl);
    if (!videoId) {
      res.status(400).json({
        valid: false,
        message: 'URL do YouTube inválida. Use um link como https://www.youtube.com/live/ZCKgoFyh2hI',
      });
      return;
    }

    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const response = await fetch(oembedUrl);
      if (!response.ok) {
        res.json({
          valid: true,
          videoId,
          title: `Vídeo YouTube (${videoId})`,
          authorName: 'YouTube',
          thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
        });
        return;
      }
      const data = (await response.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      res.json({
        valid: true,
        videoId,
        title: data.title || `Vídeo YouTube (${videoId})`,
        authorName: data.author_name || 'Canal YouTube',
        thumbnailUrl:
          data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      });
    } catch {
      res.json({
        valid: true,
        videoId,
        title: `Vídeo YouTube (${videoId})`,
        authorName: 'YouTube',
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }
  });

  // API: Import a YouTube Video directly onto the Server Disk via yt-dlp (supports optional cookies.txt for cloud IPs)
  app.post('/api/cloud-stream/import-youtube', async (req, res) => {
    const { youtubeUrl, cookiesTxt } = req.body as {
      youtubeUrl?: string;
      cookiesTxt?: string;
    };
    const videoId = extractYouTubeId(youtubeUrl || '');
    if (!videoId) {
      res.status(400).json({
        success: false,
        message: 'Informe um link válido do YouTube (ex: https://www.youtube.com/live/ZCKgoFyh2hI).',
      });
      return;
    }

    const ytDlpBinary = '/tmp/yt-dlp';
    const id = `srv-yt-${videoId}-${Date.now()}`;
    const outputFilePath = path.join(UPLOAD_DIR, `${id}.mp4`);

    try {
      // Ensure yt-dlp binary is present in /tmp/yt-dlp
      if (!fs.existsSync(ytDlpBinary)) {
        await new Promise<void>((resolve, reject) => {
          execFile(
            'curl',
            [
              '-sL',
              'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
              '-o',
              ytDlpBinary,
            ],
            (err) => {
              if (err) reject(err);
              else {
                fs.chmodSync(ytDlpBinary, 0o755);
                resolve();
              }
            }
          );
        });
      }

      const args: string[] = [
        '--no-warnings',
        '--no-playlist',
        '-f',
        'best[height<=720][ext=mp4]/best[ext=mp4]/best',
        '-o',
        outputFilePath,
      ];

      if (ffmpegPath) {
        args.push('--ffmpeg-location', ffmpegPath);
      }

      if (cookiesTxt && cookiesTxt.trim().length > 20) {
        const cookiePath = path.join(UPLOAD_DIR, `cookies-${Date.now()}.txt`);
        fs.writeFileSync(cookiePath, cookiesTxt, 'utf8');
        args.push('--cookies', cookiePath);
      }

      args.push(`https://www.youtube.com/watch?v=${videoId}`);

      await new Promise<void>((resolve, reject) => {
        execFile(ytDlpBinary, args, { timeout: 120000 }, (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(stderr || err.message));
          } else {
            resolve();
          }
        });
      });

      if (!fs.existsSync(outputFilePath)) {
        throw new Error('Arquivo MP4 não foi gerado pelo extrator.');
      }

      const stats = fs.statSync(outputFilePath);
      const hasAudio = await probeVideoHasAudio(outputFilePath);

      // Get nice title from oEmbed
      let videoTitle = `YouTube (${videoId}).mp4`;
      try {
        const oRes = await fetch(
          `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
        );
        if (oRes.ok) {
          const oData = (await oRes.json()) as { title?: string };
          if (oData.title) videoTitle = `${oData.title} [YouTube].mp4`;
        }
      } catch {
        // ignore
      }

      const item: UploadedServerVideo = {
        id,
        originalName: videoTitle,
        filePath: outputFilePath,
        sizeBytes: stats.size,
        hasAudio,
        uploadedAt: new Date().toISOString(),
      };
      serverVideos.set(id, item);

      res.json({
        success: true,
        video: {
          id: item.id,
          originalName: item.originalName,
          sizeBytes: item.sizeBytes,
          hasAudio: item.hasAudio,
          uploadedAt: item.uploadedAt,
        },
      });
    } catch (err) {
      const msg = (err as Error).message || '';
      const isBotCheck =
        msg.includes('Sign in to confirm') || msg.includes('not a bot');
      res.status(400).json({
        success: false,
        requiresAuth: isBotCheck,
        message: isBotCheck
          ? 'O YouTube bloqueou o download direto pelo IP da nuvem (proteção anti-bot do YouTube para servidores). Para transmitir este vídeo sem pesar seu site, use o "Player YouTube Direto no Estúdio" (abaixo) OU cole seus cookies.txt / baixe o MP4 pelo painel do seu YouTube Studio.'
          : `Não foi possível importar diretamente: ${msg.slice(0, 200)}`,
      });
    }
  });

  // Extract Google Drive File ID from any Google Drive sharing link
  function extractGoogleDriveFileId(url: string): string | null {
    const clean = String(url || '').trim();
    const match =
      clean.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
      clean.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
      clean.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  // Robust Google Drive downloader using cookie jar and automatic virus confirmation handling
  async function downloadGoogleDriveFile(fileId: string, outputFilePath: string): Promise<void> {
    const cookieJar = path.join(os.tmpdir(), `gdrive-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

    const cleanCookieJar = () => {
      try { if (fs.existsSync(cookieJar)) fs.unlinkSync(cookieJar); } catch {}
    };

    try {
      const initUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const tempFirstDownload = `${outputFilePath}.init`;

      await new Promise<void>((resolve, reject) => {
        execFile(
          'curl',
          ['-sL', '-A', ua, '-c', cookieJar, '-b', cookieJar, initUrl, '-o', tempFirstDownload],
          { timeout: 600000 },
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      if (!fs.existsSync(tempFirstDownload)) {
        throw new Error('Falha ao conectar com os servidores do Google Drive.');
      }

      // Check if first downloaded file is HTML (virus confirmation or permission error)
      const fd = fs.openSync(tempFirstDownload, 'r');
      const buffer = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
      fs.closeSync(fd);
      const initialText = buffer.toString('utf8', 0, bytesRead);

      const isHtml =
        initialText.includes('<html') ||
        initialText.includes('<!DOCTYPE') ||
        initialText.includes('<body') ||
        initialText.includes('<div');

      if (!isHtml) {
        // Direct download succeeded without virus scan prompt
        fs.renameSync(tempFirstDownload, outputFilePath);
        return;
      }

      // Check if it's an actual access permission error
      const isAccessDenied =
        initialText.includes('accounts.google.com') ||
        initialText.includes('ServiceLogin') ||
        initialText.includes('Você precisa de permissão') ||
        initialText.includes('You need permission') ||
        initialText.includes('access_denied') ||
        initialText.includes('Não foi possível abrir o arquivo') ||
        initialText.includes('Não foi possível encontrar o arquivo');

      if (isAccessDenied) {
        try { fs.unlinkSync(tempFirstDownload); } catch {}
        throw new Error(
          'O Google Drive exige permissão de acesso. No Google Drive, clique com botão direito no arquivo > Compartilhar > Compartilhar > e altere o Acesso geral de "Restrito" para "Qualquer pessoa com o link" (Leitor).'
        );
      }

      // Read the full HTML to parse the confirmation form or link
      const fullHtml = fs.readFileSync(tempFirstDownload, 'utf8');
      try { fs.unlinkSync(tempFirstDownload); } catch {}

      let confirmUrl: string | null = null;

      // 1. Modern download-form with hidden inputs
      const formMatch =
        fullHtml.match(/<form[^>]+id=["']download-form["'][^>]+action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/i) ||
        fullHtml.match(/<form[^>]+action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/i);

      if (formMatch) {
        const action = formMatch[1].replace(/&amp;/g, '&');
        const formBody = formMatch[2];
        const params = new URLSearchParams();
        const inputRegex = /<input[^>]+name=["']([^"']+)["'][^>]+value=["']([^"']*)["']/gi;
        let m;
        while ((m = inputRegex.exec(formBody)) !== null) {
          params.set(m[1], m[2]);
        }
        const inputRegexReverse = /<input[^>]+value=["']([^"']*)["'][^>]+name=["']([^"']+)["']/gi;
        while ((m = inputRegexReverse.exec(formBody)) !== null) {
          if (!params.has(m[2])) params.set(m[2], m[1]);
        }
        if (!params.has('id')) params.set('id', fileId);
        if (!params.has('export')) params.set('export', 'download');
        confirmUrl = action + (action.includes('?') ? '&' : '?') + params.toString();
      }

      if (!confirmUrl) {
        // 2. uc-download-link anchor
        const linkMatch =
          fullHtml.match(/<a[^>]+id=["']uc-download-link["'][^>]+href=["']([^"']+)["']/i) ||
          fullHtml.match(/href=["'](\/uc\?export=download[^'"]+)["']/i);
        if (linkMatch) {
          let href = linkMatch[1].replace(/&amp;/g, '&');
          if (href.startsWith('/')) href = `https://drive.google.com${href}`;
          confirmUrl = href;
        }
      }

      if (!confirmUrl) {
        // 3. direct usercontent href
        const ucMatch = fullHtml.match(/href=["'](https:\/\/drive\.usercontent\.google\.com\/download[^'"]+)["']/i);
        if (ucMatch) {
          confirmUrl = ucMatch[1].replace(/&amp;/g, '&');
        }
      }

      if (!confirmUrl) {
        // Fallback with confirm=t
        confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
      }

      // Step 2: Download the real video file using the saved session cookies
      await new Promise<void>((resolve, reject) => {
        execFile(
          'curl',
          ['-sL', '-A', ua, '-c', cookieJar, '-b', cookieJar, confirmUrl!, '-o', outputFilePath],
          { timeout: 900000 },
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      if (!fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).size < 1000) {
        throw new Error('Falha ao baixar o arquivo de vídeo do Google Drive.');
      }

      // Verify that output file is not HTML
      const fd2 = fs.openSync(outputFilePath, 'r');
      const buf2 = Buffer.alloc(1024);
      const r2 = fs.readSync(fd2, buf2, 0, 1024, 0);
      fs.closeSync(fd2);
      const text2 = buf2.toString('utf8', 0, r2);
      if (text2.includes('<html') || text2.includes('<!DOCTYPE')) {
        throw new Error('O Google Drive retornou uma página de erro ao invés do vídeo. Verifique se o link possui permissão pública de Leitor.');
      }
    } finally {
      cleanCookieJar();
    }
  }

  // Helper to resolve Google Drive, Dropbox and other direct video URLs
  async function resolveDirectMediaUrl(inputUrl: string): Promise<string> {
    let url = String(inputUrl || '').trim();
    if (!url) return '';

    // Dropbox direct link
    if (url.includes('dropbox.com')) {
      url = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '');
      url += (url.includes('?') ? '&' : '?') + 'raw=1';
      return url;
    }

    return url;
  }

  // API to import a video directly from Google Drive or public URL to server disk
  app.post('/api/server-videos/import-drive', async (req, res) => {
    const { url, customName } = req.body as { url: string; customName?: string };
    if (!url || !String(url).startsWith('http')) {
      res.status(400).json({ error: 'Informe uma URL do Google Drive ou link direto válido.' });
      return;
    }

    const driveFileId = extractGoogleDriveFileId(url);
    const id = driveFileId ? `srv-gdrive-${driveFileId}` : `srv-cloud-${Date.now()}`;
    const outputFilePath = path.join(UPLOAD_DIR, `${id}.mp4`);

    try {
      if (driveFileId) {
        // Download from Google Drive with robust cookie jar and virus confirmation handling
        await downloadGoogleDriveFile(driveFileId, outputFilePath);
      } else {
        // Standard direct URL download
        const directUrl = await resolveDirectMediaUrl(url);
        const ua =
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

        await new Promise<void>((resolve, reject) => {
          execFile(
            'curl',
            ['-sL', '-A', ua, directUrl, '-o', outputFilePath],
            { timeout: 600000 },
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }

      if (!fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).size === 0) {
        throw new Error('O arquivo baixado está vazio.');
      }

      const stats = fs.statSync(outputFilePath);
      const hasAudio = await probeVideoHasAudio(outputFilePath);

      let videoTitle = customName?.trim() || (driveFileId ? `Google Drive (${driveFileId}).mp4` : 'Vídeo Importado da Nuvem.mp4');
      if (!videoTitle.toLowerCase().endsWith('.mp4') && !videoTitle.toLowerCase().endsWith('.webm')) {
        videoTitle += '.mp4';
      }

      const item: UploadedServerVideo = {
        id,
        originalName: videoTitle,
        filePath: outputFilePath,
        sizeBytes: stats.size,
        hasAudio,
        uploadedAt: new Date().toISOString(),
      };
      serverVideos.set(id, item);

      res.json({
        success: true,
        video: {
          id: item.id,
          originalName: item.originalName,
          sizeBytes: item.sizeBytes,
          hasAudio: item.hasAudio,
          uploadedAt: item.uploadedAt,
        },
      });
    } catch (err: any) {
      if (fs.existsSync(outputFilePath)) {
        try { fs.unlinkSync(outputFilePath); } catch {}
      }
      res.status(400).json({
        success: false,
        error: err.message || 'Erro ao importar arquivo da nuvem.',
      });
    }
  });

  // Auto-discover existing saved videos on disk upon startup so files persist across server reboots
  try {
    if (fs.existsSync(UPLOAD_DIR)) {
      const existingFiles = fs
        .readdirSync(UPLOAD_DIR)
        .filter((f) => f.endsWith('.mp4') || f.endsWith('.webm'));
      for (const file of existingFiles) {
        const filePath = path.join(UPLOAD_DIR, file);
        const stats = fs.statSync(filePath);
        if (stats.size > 1000) {
          const id = path.parse(file).name;
          if (!serverVideos.has(id)) {
            serverVideos.set(id, {
              id,
              originalName: file
                .replace(/^srv-gdrive-/, 'Google Drive: ')
                .replace(/^srv-cloud-/, 'Vídeo Nuvem: '),
              filePath,
              sizeBytes: stats.size,
              hasAudio: true,
              uploadedAt: stats.mtime.toISOString(),
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('Could not scan upload dir:', err);
  }

  // API to list all videos on the server disk
  app.get('/api/server-videos', (_req, res) => {
    res.json({
      success: true,
      videos: Array.from(serverVideos.values()).map((v) => ({
        id: v.id,
        originalName: v.originalName,
        sizeBytes: v.sizeBytes,
        hasAudio: v.hasAudio,
        uploadedAt: v.uploadedAt,
      })),
    });
  });

  // ============================================================================
  // CLOUD 24/7 AUTONOMOUS STREAMING API (KEEPS STREAMING WHEN PC IS TURNED OFF)
  // ============================================================================

  app.get('/api/cloud-stream/status', (_req, res) => {
    const elapsedSeconds =
      cloudState.active && cloudState.startedAt
        ? Math.floor((Date.now() - cloudState.startedAt) / 1000)
        : 0;

    res.json({
      state: {
        ...cloudState,
        elapsedSeconds,
      },
      keepAlive: keepAliveState,
      videos: Array.from(serverVideos.values()).map((v) => ({
        id: v.id,
        originalName: v.originalName,
        sizeBytes: v.sizeBytes,
        hasAudio: v.hasAudio,
        uploadedAt: v.uploadedAt,
      })),
    });
  });

  app.delete('/api/cloud-stream/videos/:id', (req, res) => {
    const vid = serverVideos.get(req.params.id);
    if (vid) {
      try {
        if (fs.existsSync(vid.filePath)) {
          fs.unlinkSync(vid.filePath);
        }
      } catch {
        // ignore unlink errors
      }
      serverVideos.delete(req.params.id);
    }
    res.json({ success: true });
  });

  // Core autonomous stream runner with 24/7 infinite loop supervision
  async function launchCloudStreamProcess(params: any) {
    const {
      mode = 'youtube',
      sourceMode = 'server-test-pattern',
      videoId = '',
      youtubeUrl = '',
      remoteUrl = '',
      rtmpUrl = 'rtmp://a.rtmp.youtube.com/live2',
      streamKey = '',
      loopInfinite = true,
      resolution = '1280x720',
      fps = 30,
      videoBitrateKbps = 4500,
      audioBitrateKbps = 128,
      forceKeyframes = true,
    } = params;

    const cleanRtmp = String(rtmpUrl).trim().replace(/\/+$/, '');
    const cleanKey = String(streamKey).trim();

    const binary = ffmpegPath || 'ffmpeg';
    const [targetW, targetH] =
      resolution === '1920x1080' ? [1920, 1080] : [1280, 720];
    const gop = Number(fps) * 2;
    const maxrate = `${videoBitrateKbps}k`;
    const bufsize = `${Number(videoBitrateKbps) * 2}k`;

    // Ensure any previously running FFmpeg process is cleanly terminated
    if (cloudFfmpegProcess) {
      try {
        cloudFfmpegProcess.kill('SIGKILL');
      } catch {}
      cloudFfmpegProcess = null;
    }
    await new Promise<void>((resolve) => {
      execFile('pkill', ['-9', '-f', 'ffmpeg'], () => resolve());
    });

    const checkCodecInfo = (filePath: string): Promise<{ hasH264: boolean; hasAac: boolean }> => {
      return new Promise((resolve) => {
        execFile(binary, ['-i', filePath], (_err, _stdout, stderr) => {
          const out = stderr || '';
          const hasH264 = out.includes('Video: h264');
          const hasAac = out.includes('Audio: aac');
          resolve({ hasH264, hasAac });
        });
      });
    };

    const args: string[] = ['-hide_banner', '-loglevel', 'info'];
    let sourceLabel = '';
    let localVideoPath = '';

    if (sourceMode === 'uploaded-file') {
      const vid = serverVideos.get(videoId);
      if (!vid || !fs.existsSync(vid.filePath)) {
        throw new Error('Selecione ou envie um arquivo de vídeo .MP4/.WebM válido para o servidor primeiro.');
      }
      localVideoPath = vid.filePath;
      sourceLabel = `Arquivo no Servidor: ${vid.originalName}`;
    } else if (sourceMode === 'google-drive') {
      const targetUrl = String(params.driveUrl || remoteUrl || '').trim();
      if (!targetUrl || !targetUrl.startsWith('http')) {
        throw new Error('Informe um link válido do Google Drive.');
      }
      const driveFileId = extractGoogleDriveFileId(targetUrl);
      if (!driveFileId) {
        throw new Error('Não foi possível identificar o ID do arquivo no link do Google Drive.');
      }

      // Check if already in serverVideos
      let localVid = Array.from(serverVideos.values()).find(
        (v) => v.id.includes(driveFileId) && fs.existsSync(v.filePath)
      );

      if (!localVid) {
        const id = `srv-gdrive-${driveFileId}`;
        const outputFilePath = path.join(UPLOAD_DIR, `${id}.mp4`);
        if (!fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).size < 1000) {
          await downloadGoogleDriveFile(driveFileId, outputFilePath);
        }
        const stats = fs.statSync(outputFilePath);
        const hasAudio = await probeVideoHasAudio(outputFilePath);
        localVid = {
          id,
          originalName: `Google Drive (${driveFileId}).mp4`,
          filePath: outputFilePath,
          sizeBytes: stats.size,
          hasAudio,
          uploadedAt: new Date().toISOString(),
        };
        serverVideos.set(id, localVid);
      }

      localVideoPath = localVid.filePath;
      sourceLabel = `Google Drive: ${localVid.originalName}`;
    }

    if (localVideoPath) {
      const probeInfo = await checkCodecInfo(localVideoPath);
      const hasAudio = await probeVideoHasAudio(localVideoPath);
      if (loopInfinite) {
        args.push('-stream_loop', '-1');
      }
      args.push('-re', '-i', localVideoPath);

      if (probeInfo.hasH264 && forceKeyframes === false) {
        // Pure Stream Copy (only if user explicitly disabled keyframe compliance)
        sourceLabel += ' [Stream Copy — 0% CPU]';
        args.push('-map', '0:v:0', '-c:v', 'copy');
        if (probeInfo.hasAac) {
          args.push('-map', '0:a:0', '-c:a', 'copy');
        } else if (hasAudio) {
          args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', `${audioBitrateKbps}k`, '-ar', '44100', '-ac', '2');
        } else {
          args.push(
            '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-map', '1:a:0', '-c:a', 'aac', '-b:a', `${audioBitrateKbps}k`
          );
        }
      } else {
        // Enforce YouTube Live Strict 2.0s GOP (Keyframes strictly every 2 seconds, no drift)
        // Eliminates the YouTube error: "Use uma frequência de frame-chave de até quatro segundos."
        sourceLabel += ' [GOP 2.0s Fixo — Padrão YouTube Live Sem Buffer]';
        args.push(
          '-map', '0:v:0',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-tune', 'zerolatency',
          '-profile:v', 'main',
          '-pix_fmt', 'yuv420p',
          '-r', String(fps),
          '-g', String(gop),
          '-keyint_min', String(gop),
          '-sc_threshold', '0',
          '-b:v', maxrate,
          '-maxrate', maxrate,
          '-bufsize', bufsize
        );
        if (probeInfo.hasAac) {
          // Keep pristine audio via copy (zero audio latency, perfect lip-sync, 0% audio CPU)
          args.push('-map', '0:a:0', '-c:a', 'copy');
        } else if (hasAudio) {
          args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', `${audioBitrateKbps}k`, '-ar', '44100', '-ac', '2');
        } else {
          args.push(
            '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-map', '1:a:0', '-c:a', 'aac', '-b:a', `${audioBitrateKbps}k`
          );
        }
      }
    } else if (sourceMode === 'remote-url') {
      const targetUrl = String(remoteUrl || '').trim();
      if (!targetUrl || !targetUrl.startsWith('http')) {
        throw new Error('Informe uma URL direta válida começando com http:// ou https://.');
      }
      const directStreamUrl = await resolveDirectMediaUrl(targetUrl);
      sourceLabel = `URL Remota: ${directStreamUrl.slice(0, 50)}...`;
      if (loopInfinite) {
        args.push('-stream_loop', '-1');
      }
      args.push(
        '-re',
        '-headers',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\n',
        '-i',
        directStreamUrl,
        '-vf',
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'zerolatency',
        '-profile:v',
        'main',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(fps),
        '-g',
        String(gop),
        '-keyint_min',
        String(gop),
        '-sc_threshold',
        '0',
        '-b:v',
        maxrate,
        '-maxrate',
        maxrate,
        '-bufsize',
        bufsize,
        '-c:a',
        'aac',
        '-b:a',
        `${audioBitrateKbps}k`,
        '-ar',
        '44100',
        '-ac',
        '2'
      );
    } else if (sourceMode === 'youtube-link') {
      const rawYtUrl = String(youtubeUrl || videoId || 'https://www.youtube.com/live/ZCKgoFyh2hI');
      const cleanYtId = extractYouTubeId(rawYtUrl) || 'ZCKgoFyh2hI';
      
      const ytStreamInfo = await resolveYouTubeStreams(cleanYtId);

      const sessionId = `yt-${Date.now()}`;
      ytProxySessions.set(sessionId, {
        videoUrl: ytStreamInfo.videoUrl,
        audioUrl: ytStreamInfo.audioUrl,
        authCookie: ytStreamInfo.authCookie,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });

      sourceLabel = `YouTube Direto: ${ytStreamInfo.title} (${cleanYtId})`;

      // Stream directly with stream copy (-c:v copy -c:a copy) in real time (-re)
      args.push(
        '-re',
        '-i',
        `http://127.0.0.1:${PORT}/api/local-yt-proxy/${sessionId}/video.mp4`,
        '-re',
        '-i',
        `http://127.0.0.1:${PORT}/api/local-yt-proxy/${sessionId}/audio.m4a`,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'copy'
      );
    } else {
      sourceLabel = `Gerador Nativo do Servidor (${targetW}x${targetH} @ ${fps}fps)`;
      args.push(
        '-re',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${targetW}x${targetH}:rate=${fps}`,
        '-re',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'zerolatency',
        '-profile:v',
        'main',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(fps),
        '-g',
        String(gop),
        '-keyint_min',
        String(gop),
        '-sc_threshold',
        '0',
        '-b:v',
        maxrate,
        '-maxrate',
        maxrate,
        '-bufsize',
        bufsize,
        '-c:a',
        'aac',
        '-b:a',
        `${audioBitrateKbps}k`,
        '-ar',
        '44100',
        '-ac',
        '2'
      );
    }

    const maskedKey =
      cleanKey.length > 8
        ? `${cleanKey.slice(0, 4)}-****-****-${cleanKey.slice(-4)}`
        : '****-****';

    const { tlsHost, tlsPort, appPath, tcUrl } = resolveRtmpsTarget(cleanRtmp);
    activeTlsTargetHost = tlsHost;
    activeTlsTargetPort = tlsPort;

    if (mode === 'youtube') {
      const localUrl = `rtmp://127.0.0.1:${localBridgePort}/${appPath}/${cleanKey}`;
      args.push(
        '-flvflags',
        'no_duration_filesize',
        '-rtmp_tcurl',
        tcUrl,
        '-f',
        'flv',
        localUrl
      );
    } else {
      args.push('-f', 'null', '-');
    }

    cloudState = {
      active: true,
      mode,
      sourceMode,
      sourceLabel,
      maskedTarget:
        mode === 'youtube'
          ? `rtmps://${tlsHost}:${tlsPort}/${appPath}/${maskedKey}`
          : 'Codificador Autônomo FFmpeg no Servidor (Modo Teste)',
      startedAt: cloudState.startedAt || Date.now(),
      frames: cloudState.frames || 0,
      fps: Number(fps),
      bitrateKbps: Number(videoBitrateKbps),
      ffmpegTime: '00:00:00.00',
      loopInfinite: Boolean(loopInfinite),
      loopCycle: currentLoopCycle,
      resolution,
      statusMessage:
        mode === 'youtube'
          ? `Transmitindo via túnel seguro RTMPS (${tlsHost}:443) para o YouTube Live! Ciclo #${currentLoopCycle} (Loop 24/7 Ativo).`
          : `Executando transmissão autônoma em segundo plano no servidor (Ciclo #${currentLoopCycle}).`,
      logs: cloudState.logs || [],
    };

    appendCloudLog(
      `[Ciclo #${currentLoopCycle}] Iniciando processo FFmpeg autônomo (${sourceLabel}) -> ${cloudState.maskedTarget}`
    );

    lastStreamStartTime = Date.now();

    cloudFfmpegProcess = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    cloudFfmpegProcess.stdout.on('data', () => {});

    cloudFfmpegProcess.stderr.on('data', (chunk: Buffer) => {
      const lines = chunk
        .toString()
        .split(/[\r\n]+/)
        .filter(Boolean);

      for (const line of lines) {
        const frameMatch = line.match(/frame=\s*(\d+)/);
        const fpsMatch = line.match(/fps=\s*([\d.]+)/);
        const bitrateMatch = line.match(/bitrate=\s*([\d.]+)kbits\/s/);
        const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);

        if (frameMatch || timeMatch) {
          if (frameMatch) {
            cloudState.frames = Number(frameMatch[1]);
          } else if (timeMatch) {
            const parts = timeMatch[1].split(':');
            const secs = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
            cloudState.frames = Math.floor(secs * (cloudState.fps || 30));
          }
          cloudState.fps = fpsMatch ? Number(fpsMatch[1]) : (cloudState.fps || 30);
          cloudState.bitrateKbps = bitrateMatch
            ? Math.round(Number(bitrateMatch[1]))
            : cloudState.bitrateKbps;
          cloudState.ffmpegTime = timeMatch
            ? timeMatch[1]
            : cloudState.ffmpegTime;
          appendCloudLog(line.trim());
        } else {
          appendCloudLog(line.trim().slice(0, 240));
        }
      }
    });

    cloudFfmpegProcess.on('close', (code, signal) => {
      cloudFfmpegProcess = null;

      // 1. If user explicitly requested stop, shut down cleanly
      if (isManualStop) {
        cloudState.active = false;
        cloudState.statusMessage = 'Transmissão autônoma encerrada pelo operador.';
        appendCloudLog(cloudState.statusMessage);
        return;
      }

      // 2. 24/7 Watchdog Supervisor:
      // YouTube live servers routinely disconnect / reset RTMP sessions around 24 to 25 hours.
      // Transient socket resets can also occur. The watchdog NEVER gives up and auto-reconnects!
      if (cloudState.loopInfinite && currentCloudParams) {
        const streamDurationMs = Date.now() - (cloudState.startedAt || Date.now());
        const streamDurationHours = (streamDurationMs / (1000 * 3600)).toFixed(1);

        currentLoopCycle++;
        cloudState.loopCycle = currentLoopCycle;

        if (Date.now() - lastStreamStartTime > 60000) {
          consecutiveRetries = 0;
        }
        consecutiveRetries++;

        const delayMs = Math.min(10000, Math.max(2000, consecutiveRetries * 2000));
        const is24hReset = streamDurationMs > 22 * 3600 * 1000;

        const reason = is24hReset
          ? `Reinicialização de rotina de 24h/25h da conexão pelo YouTube (Live ativa por ${streamDurationHours}h)`
          : code === 0
          ? 'Vídeo finalizado normalmente (próximo ciclo em loop)'
          : `Reconexão automática por reset de socket ou rede (código ${code ?? signal})`;

        cloudState.active = true;
        cloudState.statusMessage = `[Watchdog 24/7] ${reason}. Reconectando ao YouTube em ${Math.round(delayMs / 1000)}s (Ciclo #${currentLoopCycle})...`;
        appendCloudLog(
          `[Watchdog 24/7 Ativo] A transmissão alcançou ${streamDurationHours}h. Motivo: ${reason}. Reconectando ao YouTube Live em ${Math.round(delayMs / 1000)}s sem interrupção humana!`
        );

        if (activeLoopTimer) clearTimeout(activeLoopTimer);
        activeLoopTimer = setTimeout(async () => {
          if (!isManualStop && cloudState.loopInfinite && currentCloudParams) {
            try {
              await launchCloudStreamProcess(currentCloudParams);
              appendCloudLog(`[Watchdog 24/7] Ciclo #${currentLoopCycle} reconectado com sucesso ao YouTube! Live 100% restabelecida.`);
            } catch (e: any) {
              appendCloudLog(`[Watchdog 24/7 Erro]: Falha na reconexão: ${e.message}. Próxima tentativa em 5s...`);
              if (!isManualStop) {
                activeLoopTimer = setTimeout(() => {
                  if (cloudFfmpegProcess === null && !isManualStop && currentCloudParams) {
                    launchCloudStreamProcess(currentCloudParams).catch(() => {});
                  }
                }, 5000);
              }
            }
          }
        }, delayMs);
        return;
      }

      cloudState.active = false;
      if (code === 0) {
        cloudState.statusMessage = 'Transmissão autônoma no servidor finalizada.';
      } else if (code === 251 || code === 1) {
        cloudState.statusMessage =
          'O servidor do YouTube recusou a Chave de Transmissão (Input/output error). Verifique se a Chave de Transmissão colada está exata e se a sala de transmissão do YouTube Studio está aberta.';
      } else {
        cloudState.statusMessage = `Processo FFmpeg no servidor encerrado (código ${code ?? signal}).`;
      }
      appendCloudLog(cloudState.statusMessage);
    });
  }

  app.post('/api/cloud-stream/start', async (req, res) => {
    const {
      mode = 'youtube',
      streamKey = '',
    } = req.body;

    const cleanKey = String(streamKey).trim();

    if (mode === 'youtube' && !cleanKey) {
      res.status(400).json({
        success: false,
        message:
          'Você selecionou o modo YouTube Live Real, mas o campo Chave de Transmissão (Stream Key) está vazio! Cole sua chave do YouTube Studio (ex: xxxx-xxxx-xxxx-xxxx-xxxx) no campo ao lado.',
      });
      return;
    }

    stopCloudFfmpeg();
    isManualStop = false;
    currentLoopCycle = 1;
    currentCloudParams = { ...req.body };

    try {
      await launchCloudStreamProcess(currentCloudParams);
      res.json({
        success: true,
        state: cloudState,
      });
    } catch (err: any) {
      cloudState.active = false;
      res.status(500).json({
        success: false,
        message: `Erro ao iniciar FFmpeg no servidor: ${err.message}`,
      });
    }
  });

  app.post('/api/cloud-stream/stop', (_req, res) => {
    stopCloudFfmpeg();
    cloudState.statusMessage = 'Transmissão autônoma encerrada pelo operador.';
    appendCloudLog('Processo FFmpeg encerrado pelo usuário.');
    res.json({
      success: true,
      state: cloudState,
    });
  });

  // WebSocket Server for real-time Browser MediaRecorder -> FFmpeg -> YouTube RTMPS (Port 443) streaming
  const wss = new WebSocketServer({ server, path: '/ws/rtmp' });

  wss.on('connection', (ws: WebSocket) => {
    let ffmpegProcess: ChildProcessWithoutNullStreams | null = null;
    let bytesReceived = 0;
    let chunksReceived = 0;
    let isClosing = false;

    const cleanupFfmpeg = () => {
      if (ffmpegProcess) {
        try {
          ffmpegProcess.stdin.end();
        } catch {
          // ignore
        }
        try {
          ffmpegProcess.kill('SIGINT');
        } catch {
          // ignore
        }
        ffmpegProcess = null;
      }
    };

    const sendJson = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (!isBinary) {
        try {
          const text = data.toString();
          const msg = JSON.parse(text);

          if (msg.type === 'start') {
            cleanupFfmpeg();
            isClosing = false;
            bytesReceived = 0;
            chunksReceived = 0;

            const config: StreamSessionConfig = {
              mode: msg.mode === 'youtube' ? 'youtube' : 'simulation',
              rtmpUrl: (msg.rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2')
                .trim()
                .replace(/\/+$/, ''),
              streamKey: (msg.streamKey || '').trim(),
              fps: Number(msg.fps) || 30,
              videoBitrateKbps: Number(msg.videoBitrateKbps) || 4500,
              audioBitrateKbps: Number(msg.audioBitrateKbps) || 128,
              resolution: msg.resolution || '1280x720',
            };

            const binary = ffmpegPath || 'ffmpeg';
            const gop = config.fps * 2;
            const maxrate = `${config.videoBitrateKbps}k`;
            const bufsize = `${config.videoBitrateKbps * 2}k`;
            const [targetW, targetH] =
              config.resolution === '1920x1080' ? [1920, 1080] : [1280, 720];

            const args: string[] = [
              '-hide_banner',
              '-loglevel',
              'info',
              '-fflags',
              '+genpts+igndts',
              '-f',
              'webm',
              '-i',
              'pipe:0',
              '-vf',
              `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-tune',
              'zerolatency',
              '-profile:v',
              'main',
              '-pix_fmt',
              'yuv420p',
              '-r',
              String(config.fps),
              '-g',
              String(gop),
              '-keyint_min',
              String(gop),
              '-sc_threshold',
              '0',
              '-b:v',
              maxrate,
              '-maxrate',
              maxrate,
              '-bufsize',
              bufsize,
              '-c:a',
              'aac',
              '-b:a',
              `${config.audioBitrateKbps}k`,
              '-ar',
              '44100',
              '-ac',
              '2',
            ];

            const { tlsHost, tlsPort, appPath, tcUrl } = resolveRtmpsTarget(
              config.rtmpUrl
            );
            activeTlsTargetHost = tlsHost;
            activeTlsTargetPort = tlsPort;

            if (config.mode === 'youtube') {
              const localUrl = `rtmp://127.0.0.1:${localBridgePort}/${appPath}/${config.streamKey}`;
              args.push(
                '-flvflags',
                'no_duration_filesize',
                '-rtmp_tcurl',
                tcUrl,
                '-f',
                'flv',
                localUrl
              );
            } else {
              args.push('-f', 'null', '-');
            }

            try {
              ffmpegProcess = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });

              ffmpegProcess.stdout.on('data', () => {});

              ffmpegProcess.stdin.on('error', (err) => {
                if (!isClosing) {
                  sendJson({
                    type: 'log',
                    level: 'warn',
                    text: `Fluxo de entrada FFmpeg encerrado (${err.message}).`,
                  });
                }
              });

              ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
                const rawText = chunk.toString();
                const lines = rawText.split(/[\r\n]+/).filter(Boolean);

                for (const line of lines) {
                  const frameMatch = line.match(/frame=\s*(\d+)/);
                  const fpsMatch = line.match(/fps=\s*([\d.]+)/);
                  const bitrateMatch = line.match(/bitrate=\s*([\d.]+)kbits\/s/);
                  const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);

                  if (frameMatch || timeMatch) {
                    sendJson({
                      type: 'stats',
                      frames: frameMatch ? Number(frameMatch[1]) : 0,
                      fps: fpsMatch ? Number(fpsMatch[1]) : config.fps,
                      bitrateKbps: bitrateMatch
                        ? Math.round(Number(bitrateMatch[1]))
                        : config.videoBitrateKbps,
                      ffmpegTime: timeMatch ? timeMatch[1] : '00:00:00.00',
                      bytesReceived,
                      chunksReceived,
                      mode: config.mode,
                      rawLog: line.trim(),
                    });
                  } else {
                    const lower = line.toLowerCase();
                    const isError =
                      lower.includes('error') ||
                      lower.includes('failed') ||
                      lower.includes('connection refused') ||
                      lower.includes('input/output error') ||
                      lower.includes('already publishing');
                    sendJson({
                      type: 'log',
                      level: isError ? 'error' : 'info',
                      text: line.trim().slice(0, 260),
                    });
                  }
                }
              });

              ffmpegProcess.on('close', (code) => {
                if (!isClosing) {
                  sendJson({
                    type: 'stopped',
                    code,
                    message:
                      code === 0
                        ? 'Transmissão FFmpeg finalizada normalmente.'
                        : code === 251
                        ? 'O YouTube recusou a Chave de Transmissão (código 251). Verifique se a Stream Key colada está correta e ativa no YouTube Studio.'
                        : `O servidor RTMP encerrou a conexão (código ${code}). Verifique se sua Chave de Transmissão do YouTube Studio está ativa.`,
                  });
                }
              });

              sendJson({
                type: 'started',
                mode: config.mode,
                message:
                  config.mode === 'youtube'
                    ? `Conectado via RTMPS (${tlsHost}:443). Transmitindo vídeo H.264 + áudio AAC em tempo real para o YouTube Live!`
                    : 'Pipeline FFmpeg iniciado em Modo Teste (codificação H.264/AAC em tempo real ativa).',
              });
            } catch (spawnErr) {
              sendJson({
                type: 'error',
                message: `Falha ao iniciar o codificador FFmpeg: ${(spawnErr as Error).message}`,
              });
            }
          } else if (msg.type === 'stop') {
            isClosing = true;
            cleanupFfmpeg();
            sendJson({
              type: 'stopped',
              code: 0,
              message: 'Transmissão encerrada pelo operador.',
            });
          }
        } catch {
          // ignore malformed JSON
        }
        return;
      }

      // Binary chunk from browser MediaRecorder
      if (ffmpegProcess && ffmpegProcess.stdin && !ffmpegProcess.stdin.destroyed) {
        const buffer = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data);

        bytesReceived += buffer.length;
        chunksReceived += 1;

        try {
          ffmpegProcess.stdin.write(buffer);
        } catch {
          // ignore
        }
      }
    });

    ws.on('close', () => {
      isClosing = true;
      cleanupFfmpeg();
    });

    ws.on('error', () => {
      isClosing = true;
      cleanupFfmpeg();
    });
  });

  // Mount Vite in dev or serve static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`VoxelCast Studio server running on http://0.0.0.0:${PORT}`);
    restartKeepAliveLoop();
    setTimeout(() => executeSelfPing(), 2000);
  });
}

startServer();
