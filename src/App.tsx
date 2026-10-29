import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Video,
  Camera,
  Monitor,
  Type,
  Image as ImageIcon,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Plus,
  Volume2,
  VolumeX,
  Radio,
  Disc,
  Play,
  Pause,
  Repeat,
  ArrowUp,
  ArrowDown,
  Maximize2,
  PictureInPicture2,
  Columns,
  ArrowRightLeft,
  Mic,
  MicOff,
  Download,
  Sliders,
  Film,
} from 'lucide-react';
import {
  StudioScene,
  StudioSource,
  PlaylistVideoItem,
  YouTubeRtmpConfig,
  StreamStats,
  SynthPresetId,
} from './types/studio';
import {
  DEFAULT_SCENES,
  DEFAULT_PLAYLIST_ITEMS,
  DEFAULT_RTMP_CONFIG,
} from './data/defaultStudioState';
import {
  MediaElementRegistry,
  renderSceneToCanvas,
  formatSecondsToTimecode,
} from './utils/canvasRenderer';
import { YouTubeRtmpModal } from './components/YouTubeRtmpModal';
import { PlaylistManagerView } from './components/PlaylistManagerView';
import { ArchitectureGuideView } from './components/ArchitectureGuideView';
import { CloudAutonomousView } from './components/CloudAutonomousView';

type ActiveTab = 'studio' | 'cloud247' | 'playlist' | 'rtmp' | 'guide';

export default function App() {
  // Navigation state
  const [activeTab, setActiveTab] = useState<ActiveTab>('studio');

  // Scenes & Studio Mode state
  const [scenes, setScenes] = useState<StudioScene[]>(DEFAULT_SCENES);
  const [programSceneId, setProgramSceneId] = useState<string>(DEFAULT_SCENES[0].id);
  const [previewSceneId, setPreviewSceneId] = useState<string>(
    DEFAULT_SCENES[1]?.id || DEFAULT_SCENES[0].id
  );
  const [studioMode, setStudioMode] = useState<boolean>(false);
  const [transitionAlpha, setTransitionAlpha] = useState<number>(0);

  // Selected source in active editing scene
  const editingSceneId = studioMode ? previewSceneId : programSceneId;
  const editingScene =
    scenes.find((s) => s.id === editingSceneId) || scenes[0];
  const programScene =
    scenes.find((s) => s.id === programSceneId) || scenes[0];

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(
    DEFAULT_SCENES[0].sources[0]?.id || null
  );

  // Playlist state
  const [playlist, setPlaylist] = useState<PlaylistVideoItem[]>(
    DEFAULT_PLAYLIST_ITEMS
  );
  const [activePlaylistItemId, setActivePlaylistItemId] = useState<string>(
    DEFAULT_PLAYLIST_ITEMS[0].id
  );

  // RTMP & Encoder state (persisted in localStorage so Stream Key is saved across reloads)
  const [rtmpConfig, setRtmpConfig] = useState<YouTubeRtmpConfig>(() => {
    try {
      const saved = localStorage.getItem('voxelcast_rtmp_config');
      if (saved) {
        return { ...DEFAULT_RTMP_CONFIG, ...JSON.parse(saved) };
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_RTMP_CONFIG;
  });

  useEffect(() => {
    try {
      localStorage.setItem('voxelcast_rtmp_config', JSON.stringify(rtmpConfig));
    } catch {
      // ignore storage errors
    }
  }, [rtmpConfig]);

  const [streamStats, setStreamStats] = useState<StreamStats>({
    isStreaming: false,
    isRecordingLocal: false,
    elapsedSeconds: 0,
    framesSent: 0,
    currentFps: 30,
    bitrateKbps: 0,
    bytesTransferred: 0,
    ffmpegTime: '00:00:00.00',
    connectionState: 'idle',
    statusMessage: 'Pronto para transmitir ou gravar.',
  });

  // Local Recording Download URL
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedFileName, setRecordedFileName] = useState<string>('');
  const [ffmpegLogs, setFfmpegLogs] = useState<string[]>([]);
  const [youtubeStudioPlayer, setYoutubeStudioPlayer] = useState<{
    visible: boolean;
    videoId: string;
    title: string;
    rawUrl: string;
  }>({
    visible: false,
    videoId: 'ZCKgoFyh2hI',
    title: 'lo-fi relaxante (canal xgx)',
    rawUrl: 'https://www.youtube.com/live/ZCKgoFyh2hI',
  });

  // Microphone Auxiliary Channel
  const [micEnabled, setMicEnabled] = useState<boolean>(false);
  const [micVolume, setMicVolume] = useState<number>(1.0);
  const [masterVolume, setMasterVolume] = useState<number>(1.0);
  const [audioMeterLevels, setAudioMeterLevels] = useState<Record<string, number>>({});

  // Video Timeline scrubber state for selected video-file source
  const [videoProgress, setVideoProgress] = useState<{
    currentTime: number;
    duration: number;
    paused: boolean;
  }>({ currentTime: 0, duration: 0, paused: false });

  // Refs for Canvas & Media Elements
  const programCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRegistryRef = useRef<MediaElementRegistry>({
    videos: new Map(),
    images: new Map(),
  });

  // Web Audio API refs for real audio mixing into MediaRecorder
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sourceAudioNodesRef = useRef<
    Map<
      string,
      {
        sourceNode: MediaElementAudioSourceNode | MediaStreamAudioSourceNode;
        gainNode: GainNode;
      }
    >
  >(new Map());
  const micStreamRef = useRef<MediaStream | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);

  // WebSocket & MediaRecorder refs for RTMP / Local Recording
  const wsRef = useRef<WebSocket | null>(null);
  const rtmpRecorderRef = useRef<MediaRecorder | null>(null);
  const localRecorderRef = useRef<MediaRecorder | null>(null);
  const localChunksRef = useRef<Blob[]>([]);

  // File input refs
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const [newSceneName, setNewSceneName] = useState<string>('');
  const [showNewSceneInput, setShowNewSceneInput] = useState<boolean>(false);

  // Drag / Resize interaction state on Canvas
  const dragStateRef = useRef<{
    mode: 'move' | 'resize' | null;
    sourceId: string | null;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  }>({
    mode: null,
    sourceId: null,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    origW: 0,
    origH: 0,
  });

  // Ensure AudioContext is initialized when user interacts
  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioContextClass();
      const dest = ctx.createMediaStreamDestination();
      audioCtxRef.current = ctx;
      audioDestRef.current = dest;
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return {
      audioCtx: audioCtxRef.current,
      audioDest: audioDestRef.current!,
    };
  }, []);

  // Connect an HTMLVideoElement or MediaStream to the Web Audio Mixer
  const connectVideoElementToAudioMixer = useCallback(
    (sourceId: string, videoEl: HTMLVideoElement, initialVolume: number) => {
      try {
        const { audioCtx, audioDest } = ensureAudioContext();
        if (sourceAudioNodesRef.current.has(sourceId)) return;

        const sourceNode = audioCtx.createMediaElementSource(videoEl);
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = initialVolume;

        sourceNode.connect(gainNode);
        gainNode.connect(audioDest);
        gainNode.connect(audioCtx.destination); // Also play through speakers so operator hears the mix

        sourceAudioNodesRef.current.set(sourceId, { sourceNode, gainNode });
      } catch {
        // Fallback: native video element output if CORS or already bound
      }
    },
    [ensureAudioContext]
  );

  // Sync audio volumes and mute states with Web Audio GainNodes and HTMLVideoElements
  useEffect(() => {
    for (const scene of scenes) {
      for (const src of scene.sources) {
        const isSceneInProgram = scene.id === programSceneId;
        const effectiveGain =
          isSceneInProgram && src.visible && !src.muted
            ? src.volume * masterVolume
            : 0;

        const audioEntry = sourceAudioNodesRef.current.get(src.id);
        if (audioEntry) {
          audioEntry.gainNode.gain.value = effectiveGain;
        }

        const videoEl = mediaRegistryRef.current.videos.get(src.id);
        if (videoEl) {
          videoEl.loop = src.loop ?? true;
          videoEl.playbackRate = src.playbackRate ?? 1;
          if (!audioEntry) {
            videoEl.volume = Math.min(1, Math.max(0, effectiveGain));
            videoEl.muted = effectiveGain === 0;
          }
        }
      }
    }

    if (micGainNodeRef.current) {
      micGainNodeRef.current.gain.value = micEnabled ? micVolume * masterVolume : 0;
    }
  }, [scenes, programSceneId, masterVolume, micEnabled, micVolume]);

  // Toggle Auxiliary Microphone
  const handleToggleMicrophone = async () => {
    if (micEnabled) {
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      setMicEnabled(false);
      return;
    }

    try {
      const { audioCtx, audioDest } = ensureAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      micStreamRef.current = stream;
      const micSource = audioCtx.createMediaStreamSource(stream);
      const micGain = audioCtx.createGain();
      micGain.gain.value = micVolume * masterVolume;
      micSource.connect(micGain);
      micGain.connect(audioDest);
      micGainNodeRef.current = micGain;
      setMicEnabled(true);
    } catch {
      setStreamStats((prev) => ({
        ...prev,
        statusMessage:
          'Permissão de microfone negada pelo navegador. Verifique o ícone de cadeado na barra de endereços.',
      }));
    }
  };

  // Helper to update a source inside the currently edited scene
  const updateSource = useCallback(
    (sourceId: string, updater: (src: StudioSource) => StudioSource) => {
      setScenes((prevScenes) =>
        prevScenes.map((scene) => {
          if (scene.id !== editingSceneId) return scene;
          return {
            ...scene,
            sources: scene.sources.map((s) =>
              s.id === sourceId ? updater(s) : s
            ),
          };
        })
      );
    },
    [editingSceneId]
  );

  // Advance playlist when a video finishes if autoLoopPlaylist is enabled
  const handlePlaylistAdvance = useCallback(
    (finishedSourceId: string) => {
      if (!rtmpConfig.autoLoopPlaylist || playlist.length === 0) return;
      const currentIdx = playlist.findIndex((p) => p.id === activePlaylistItemId);
      const nextIndex = (currentIdx + 1) % playlist.length;
      const nextItem = playlist[nextIndex];
      if (!nextItem) return;

      setActivePlaylistItemId(nextItem.id);
      if (nextItem.sourceType === 'local-file' && nextItem.mediaUrl) {
        const videoEl = mediaRegistryRef.current.videos.get(finishedSourceId);
        if (videoEl) {
          videoEl.src = nextItem.mediaUrl;
          videoEl.play().catch(() => {});
        }
        updateSource(finishedSourceId, (s) => ({
          ...s,
          type: 'video-file',
          name: nextItem.title,
          mediaUrl: nextItem.mediaUrl,
        }));
      } else if (nextItem.synthPreset) {
        updateSource(finishedSourceId, (s) => ({
          ...s,
          type: 'video-synth',
          name: nextItem.title,
          synthPreset: nextItem.synthPreset,
        }));
      }
    },
    [rtmpConfig.autoLoopPlaylist, playlist, activePlaylistItemId, updateSource]
  );

  // Add Local Video File (.MP4 / .WebM / .MOV) as a new layer in the current scene + chunked sync to Cloud Server
  const handleAddVideoFilesToScene = (files: FileList, alsoAddToPlaylist = true) => {
    Array.from(files).forEach((file, idx) => {
      // Automatically upload the video file in 8MB chunks to the backend server so Modo Nuvem 24/7 also has 1GB+ files ready!
      (async () => {
        const CHUNK_SIZE = 8 * 1024 * 1024;
        const uploadId = `srv-vid-${Date.now()}-${idx}`;
        let offset = 0;
        try {
          while (offset < file.size) {
            const nextOffset = Math.min(offset + CHUNK_SIZE, file.size);
            const isLast = nextOffset >= file.size;
            await fetch('/api/cloud-stream/upload-chunk', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
                'x-upload-id': uploadId,
                'x-file-name': encodeURIComponent(file.name),
                'x-is-last-chunk': isLast ? 'true' : 'false',
              },
              body: file.slice(offset, nextOffset),
            });
            offset = nextOffset;
          }
        } catch {
          // ignore background sync error
        }
      })();

      const objectUrl = URL.createObjectURL(file);
      const sourceId = `src-vid-${Date.now()}-${idx}`;
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);

      const videoEl = document.createElement('video');
      videoEl.src = objectUrl;
      videoEl.crossOrigin = 'anonymous';
      videoEl.loop = !rtmpConfig.autoLoopPlaylist;
      videoEl.playsInline = true;
      videoEl.muted = false;
      videoEl.volume = 0.9;

      videoEl.onloadedmetadata = () => {
        const durMins = String(Math.floor(videoEl.duration / 60)).padStart(2, '0');
        const durSecs = String(Math.floor(videoEl.duration % 60)).padStart(2, '0');
        const resLabel = `${videoEl.videoWidth || 1920}x${videoEl.videoHeight || 1080}`;

        if (alsoAddToPlaylist) {
          const plId = `pl-local-${Date.now()}-${idx}`;
          setPlaylist((prev) => [
            {
              id: plId,
              title: file.name,
              durationLabel: `${durMins}:${durSecs}`,
              sourceType: 'local-file',
              mediaUrl: objectUrl,
              loop: true,
              fileSizeLabel: `${sizeMb} MB`,
              resolutionLabel: resLabel,
            },
            ...prev,
          ]);
          setActivePlaylistItemId(plId);
        }
      };

      videoEl.onended = () => {
        if (rtmpConfig.autoLoopPlaylist) {
          handlePlaylistAdvance(sourceId);
        }
      };

      mediaRegistryRef.current.videos.set(sourceId, videoEl);
      connectVideoElementToAudioMixer(sourceId, videoEl, 0.9);
      videoEl.play().catch(() => {});

      const newSource: StudioSource = {
        id: sourceId,
        name: `Vídeo: ${file.name}`,
        type: 'video-file',
        fileName: file.name,
        mediaUrl: objectUrl,
        visible: true,
        locked: false,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        borderRadius: 0,
        borderColor: '#3B82F6',
        borderWidth: 0,
        hasAudio: true,
        volume: 0.9,
        muted: false,
        loop: true,
        playbackRate: 1,
      };

      setScenes((prev) =>
        prev.map((scene) => {
          if (scene.id !== editingSceneId) return scene;
          // Hide default synthetic background generator when user adds their own real video
          const cleanedSources = scene.sources.map((s) =>
            s.type === 'video-synth' && s.width === 1920 && s.height === 1080
              ? { ...s, visible: false, muted: true }
              : s
          );
          const overlayIdx = cleanedSources.findIndex(
            (s) => s.type === 'lower-third' || s.type === 'ticker'
          );
          const nextSources = [...cleanedSources];
          if (overlayIdx >= 0) {
            nextSources.splice(overlayIdx, 0, newSource);
          } else {
            nextSources.push(newSource);
          }
          return { ...scene, sources: nextSources };
        })
      );
      setSelectedSourceId(sourceId);
    });
  };

  // Add URL Video to Playlist & Scene
  const handleAddUrlVideo = (title: string, url: string) => {
    const sourceId = `src-url-${Date.now()}`;
    const videoEl = document.createElement('video');
    videoEl.src = url;
    videoEl.crossOrigin = 'anonymous';
    videoEl.loop = true;
    videoEl.playsInline = true;
    mediaRegistryRef.current.videos.set(sourceId, videoEl);
    connectVideoElementToAudioMixer(sourceId, videoEl, 0.9);
    videoEl.play().catch(() => {});

    const plId = `pl-url-${Date.now()}`;
    const newItem: PlaylistVideoItem = {
      id: plId,
      title,
      durationLabel: 'Stream Direto',
      sourceType: 'local-file',
      mediaUrl: url,
      loop: true,
      fileSizeLabel: 'URL Remota',
      resolutionLabel: '1920x1080',
    };

    setPlaylist((prev) => [newItem, ...prev]);
    setActivePlaylistItemId(plId);

    const newSource: StudioSource = {
      id: sourceId,
      name: title,
      type: 'video-file',
      mediaUrl: url,
      visible: true,
      locked: false,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      borderRadius: 0,
      borderColor: '#3B82F6',
      borderWidth: 0,
      hasAudio: true,
      volume: 0.9,
      muted: false,
      loop: true,
      playbackRate: 1,
    };

    setScenes((prev) =>
      prev.map((s) =>
        s.id === editingSceneId ? { ...s, sources: [newSource, ...s.sources] } : s
      )
    );
    setSelectedSourceId(sourceId);
  };

  // Add Webcam Source
  const handleAddWebcamSource = async () => {
    const sourceId = `src-cam-${Date.now()}`;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.playsInline = true;
      videoEl.muted = true;
      await videoEl.play();
      mediaRegistryRef.current.videos.set(sourceId, videoEl);

      const newSource: StudioSource = {
        id: sourceId,
        name: 'Webcam Ao Vivo (PiP)',
        type: 'webcam',
        visible: true,
        locked: false,
        x: 1340,
        y: 640,
        width: 520,
        height: 292,
        opacity: 1,
        borderRadius: 12,
        borderColor: '#3B82F6',
        borderWidth: 4,
        hasAudio: false,
        volume: 0,
        muted: true,
      };

      setScenes((prev) =>
        prev.map((s) =>
          s.id === editingSceneId
            ? { ...s, sources: [...s.sources, newSource] }
            : s
        )
      );
      setSelectedSourceId(sourceId);
    } catch {
      setStreamStats((prev) => ({
        ...prev,
        statusMessage:
          'Não foi possível acessar a Webcam. Verifique as permissões de câmera do navegador.',
      }));
    }
  };

  // Add Screen Share Source
  const handleAddScreenShareSource = async (customLabel?: string) => {
    const sourceId = `src-screen-${Date.now()}`;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        // @ts-expect-error Chrome supports preferCurrentTab for 1-click capture of embedded YouTube player
        preferCurrentTab: Boolean(customLabel),
      });
      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.playsInline = true;
      videoEl.muted = true;
      await videoEl.play();
      mediaRegistryRef.current.videos.set(sourceId, videoEl);

      // Connect captured tab audio to our Web Audio Mixer so the YouTube video's audio goes to the live stream!
      if (stream.getAudioTracks().length > 0) {
        try {
          const { audioCtx, audioDest } = ensureAudioContext();
          const streamAudioSource = audioCtx.createMediaStreamSource(stream);
          const gainNode = audioCtx.createGain();
          gainNode.gain.value = 1.0;
          streamAudioSource.connect(gainNode);
          gainNode.connect(audioDest);
          sourceAudioNodesRef.current.set(sourceId, {
            sourceNode: streamAudioSource,
            gainNode,
          });
        } catch {
          // ignore audio bind error
        }
      }

      const newSource: StudioSource = {
        id: sourceId,
        name: customLabel || 'Captura de Tela / Janela',
        type: 'screen',
        visible: true,
        locked: false,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        borderRadius: 0,
        borderColor: '#3B82F6',
        borderWidth: 0,
        hasAudio: stream.getAudioTracks().length > 0,
        volume: 1,
        muted: false,
      };

      setScenes((prev) =>
        prev.map((s) =>
          s.id === editingSceneId
            ? {
                ...s,
                sources: [
                  ...s.sources.map((item) =>
                    item.type === 'video-synth'
                      ? { ...item, visible: false, muted: true }
                      : item
                  ),
                  newSource,
                ],
              }
            : s
        )
      );
      setSelectedSourceId(sourceId);
    } catch {
      setStreamStats((prev) => ({
        ...prev,
        statusMessage: 'Compartilhamento de guia/tela cancelado.',
      }));
    }
  };

  // Add Image Overlay Source
  const handleAddImageFile = (files: FileList) => {
    const file = files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const sourceId = `src-img-${Date.now()}`;
    const imgEl = new Image();
    imgEl.src = url;
    mediaRegistryRef.current.images.set(sourceId, imgEl);

    const newSource: StudioSource = {
      id: sourceId,
      name: `Imagem: ${file.name}`,
      type: 'image',
      mediaUrl: url,
      visible: true,
      locked: false,
      x: 1560,
      y: 60,
      width: 280,
      height: 160,
      opacity: 0.95,
      borderRadius: 8,
      borderColor: '#334155',
      borderWidth: 0,
      hasAudio: false,
      volume: 0,
      muted: true,
    };

    setScenes((prev) =>
      prev.map((s) =>
        s.id === editingSceneId
          ? { ...s, sources: [...s.sources, newSource] }
          : s
      )
    );
    setSelectedSourceId(sourceId);
  };

  // Add Lower Third Overlay
  const handleAddLowerThird = () => {
    const sourceId = `src-lt-${Date.now()}`;
    const newSource: StudioSource = {
      id: sourceId,
      name: 'Nova Tarja (Lower Third)',
      type: 'lower-third',
      visible: true,
      locked: false,
      x: 72,
      y: 830,
      width: 820,
      height: 132,
      opacity: 0.95,
      borderRadius: 8,
      borderColor: '#DC2626',
      borderWidth: 0,
      hasAudio: false,
      volume: 0,
      muted: true,
      primaryText: 'TÍTULO DA APRESENTAÇÃO AO VIVO',
      secondaryText: 'Subtítulo ou nome do apresentador · YouTube Live',
      accentColor: '#DC2626',
      textColor: '#F8FAFC',
      fontSize: 30,
    };

    setScenes((prev) =>
      prev.map((s) =>
        s.id === editingSceneId
          ? { ...s, sources: [...s.sources, newSource] }
          : s
      )
    );
    setSelectedSourceId(sourceId);
  };

  // Play a Playlist Item in the active scene's main video slot
  const handlePlayPlaylistItemInStudio = (item: PlaylistVideoItem) => {
    setActivePlaylistItemId(item.id);

    // Find primary video layer in editing scene, or create one
    const targetVideoSource = editingScene.sources.find(
      (s) => s.type === 'video-file' || s.type === 'video-synth'
    );

    if (item.sourceType === 'local-file' && item.mediaUrl) {
      if (targetVideoSource) {
        let videoEl = mediaRegistryRef.current.videos.get(targetVideoSource.id);
        if (!videoEl) {
          videoEl = document.createElement('video');
          videoEl.crossOrigin = 'anonymous';
          videoEl.playsInline = true;
          mediaRegistryRef.current.videos.set(targetVideoSource.id, videoEl);
          connectVideoElementToAudioMixer(targetVideoSource.id, videoEl, 0.9);
        }
        videoEl.src = item.mediaUrl;
        videoEl.loop = item.loop;
        videoEl.play().catch(() => {});

        updateSource(targetVideoSource.id, (s) => ({
          ...s,
          name: item.title,
          type: 'video-file',
          mediaUrl: item.mediaUrl,
          loop: item.loop,
          visible: true,
        }));
        setSelectedSourceId(targetVideoSource.id);
      }
    } else if (item.synthPreset) {
      if (targetVideoSource) {
        updateSource(targetVideoSource.id, (s) => ({
          ...s,
          name: item.title,
          type: 'video-synth',
          synthPreset: item.synthPreset,
          visible: true,
        }));
        setSelectedSourceId(targetVideoSource.id);
      }
    }

    setActiveTab('studio');
  };

  // Start / Stop Live RTMP Stream to YouTube via Backend WebSocket + FFmpeg
  const handleToggleLiveStream = () => {
    if (streamStats.isStreaming) {
      // Stop streaming
      if (rtmpRecorderRef.current && rtmpRecorderRef.current.state !== 'inactive') {
        rtmpRecorderRef.current.stop();
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
        wsRef.current.close();
      }
      setStreamStats((prev) => ({
        ...prev,
        isStreaming: false,
        connectionState: 'idle',
        bitrateKbps: 0,
        statusMessage: 'Transmissão encerrada.',
      }));
      return;
    }

    // If user selected real YouTube mode but hasn't entered a Stream Key yet, open RTMP settings tab
    if (rtmpConfig.mode === 'youtube' && !rtmpConfig.streamKey.trim()) {
      setActiveTab('rtmp');
      setStreamStats((prev) => ({
        ...prev,
        statusMessage:
          'Informe sua Chave de Transmissão (Stream Key) do YouTube Studio ou selecione o Modo Teste.',
      }));
      return;
    }

    const canvas = programCanvasRef.current;
    if (!canvas) return;

    const { audioCtx, audioDest } = ensureAudioContext();

    // Create a silent oscillator keep-alive on the audio destination so FFmpeg always receives a continuous audio clock even if all videos are paused
    const keepAliveOsc = audioCtx.createOscillator();
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0.0001;
    keepAliveOsc.connect(silentGain);
    silentGain.connect(audioDest);
    keepAliveOsc.start();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/rtmp`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    setFfmpegLogs([
      `[${new Date().toTimeString().slice(0, 8)}] Iniciando conexão WebSocket (${wsUrl})...`,
    ]);
    setStreamStats((prev) => ({
      ...prev,
      isStreaming: true,
      elapsedSeconds: 0,
      framesSent: 0,
      bytesTransferred: 0,
      connectionState: 'connecting',
      statusMessage: 'Conectando ao relay WebSocket / FFmpeg...',
    }));

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          mode: rtmpConfig.mode,
          rtmpUrl: rtmpConfig.ingestServerUrl,
          streamKey: rtmpConfig.streamKey,
          fps: rtmpConfig.fps,
          videoBitrateKbps: rtmpConfig.videoBitrateKbps,
          audioBitrateKbps: rtmpConfig.audioBitrateKbps,
          resolution: rtmpConfig.resolution,
        })
      );

      // Capture live composite video from Program Canvas + mixed Web Audio track
      const canvasStream = canvas.captureStream(rtmpConfig.fps);
      const combinedTracks = [
        ...canvasStream.getVideoTracks(),
        ...audioDest.stream.getAudioTracks(),
      ];
      const compositeStream = new MediaStream(combinedTracks);

      const mimeCandidates = [
        'video/webm;codecs=h264,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      const supportedMime =
        mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';

      const recorder = new MediaRecorder(compositeStream, {
        ...(supportedMime ? { mimeType: supportedMime } : {}),
        videoBitsPerSecond: rtmpConfig.videoBitrateKbps * 1000,
        audioBitsPerSecond: rtmpConfig.audioBitrateKbps * 1000,
      });

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(ev.data);
          setStreamStats((prev) => ({
            ...prev,
            bytesTransferred: prev.bytesTransferred + ev.data.size,
          }));
        }
      };

      recorder.start(250);
      rtmpRecorderRef.current = recorder;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'started') {
          setFfmpegLogs((prev) => [...prev.slice(-45), `[FFmpeg] ${msg.message}`]);
          setStreamStats((prev) => ({
            ...prev,
            connectionState: 'live',
            statusMessage: msg.message,
          }));
        } else if (msg.type === 'stats') {
          if (msg.rawLog) {
            setFfmpegLogs((prev) => [...prev.slice(-45), msg.rawLog]);
          }
          setStreamStats((prev) => ({
            ...prev,
            connectionState: 'live',
            framesSent: msg.frames || prev.framesSent,
            currentFps: msg.fps || rtmpConfig.fps,
            bitrateKbps: msg.bitrateKbps || rtmpConfig.videoBitrateKbps,
            ffmpegTime: msg.ffmpegTime || prev.ffmpegTime,
          }));
        } else if (msg.type === 'log') {
          setFfmpegLogs((prev) => [...prev.slice(-45), msg.text]);
          if (msg.level === 'error') {
            setStreamStats((prev) => ({
              ...prev,
              statusMessage: `FFmpeg: ${msg.text}`,
            }));
          }
        } else if (msg.type === 'stopped' || msg.type === 'error') {
          setFfmpegLogs((prev) => [
            ...prev.slice(-45),
            `[Encerrado] ${msg.message || 'Transmissão finalizada.'}`,
          ]);
          setStreamStats((prev) => ({
            ...prev,
            isStreaming: false,
            connectionState: msg.type === 'error' ? 'error' : 'idle',
            statusMessage: msg.message || 'Transmissão finalizada.',
          }));
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      setStreamStats((prev) => ({
        ...prev,
        isStreaming: false,
        connectionState: 'error',
        statusMessage: 'Erro na conexão WebSocket com o servidor FFmpeg.',
      }));
    };

    ws.onclose = () => {
      if (rtmpRecorderRef.current && rtmpRecorderRef.current.state !== 'inactive') {
        try {
          rtmpRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  };

  // Start / Stop Local Browser Recording (.webm download)
  const handleToggleLocalRecording = () => {
    if (streamStats.isRecordingLocal) {
      if (localRecorderRef.current && localRecorderRef.current.state !== 'inactive') {
        localRecorderRef.current.stop();
      }
      setStreamStats((prev) => ({
        ...prev,
        isRecordingLocal: false,
        statusMessage: 'Gravação local concluída. Arquivo disponível para download.',
      }));
      return;
    }

    const canvas = programCanvasRef.current;
    if (!canvas) return;
    const { audioDest } = ensureAudioContext();

    localChunksRef.current = [];
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
    }

    const canvasStream = canvas.captureStream(rtmpConfig.fps);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ]);

    const recorder = new MediaRecorder(combinedStream, {
      videoBitsPerSecond: rtmpConfig.videoBitrateKbps * 1000,
    });

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        localChunksRef.current.push(ev.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(localChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      setRecordedVideoUrl(url);
      setRecordedFileName(`transmissao-voxelcast-${stamp}.webm`);
    };

    recorder.start(500);
    localRecorderRef.current = recorder;

    setStreamStats((prev) => ({
      ...prev,
      isRecordingLocal: true,
      statusMessage: 'Gravando saída de programa localmente (.webm)...',
    }));
  };

  // Timer for live elapsed seconds & audio meter simulation/sampling
  useEffect(() => {
    const interval = setInterval(() => {
      setStreamStats((prev) => {
        if (!prev.isStreaming && !prev.isRecordingLocal) return prev;
        return {
          ...prev,
          elapsedSeconds: prev.elapsedSeconds + 1,
        };
      });

      // Update selected video progress bar if a local video file is selected
      if (selectedSourceId) {
        const videoEl = mediaRegistryRef.current.videos.get(selectedSourceId);
        if (videoEl && !Number.isNaN(videoEl.duration)) {
          setVideoProgress({
            currentTime: videoEl.currentTime,
            duration: videoEl.duration || 0,
            paused: videoEl.paused,
          });
        }
      }

      // Compute dynamic audio VU meter levels for active sources
      const levels: Record<string, number> = {};
      for (const src of programScene.sources) {
        if (src.hasAudio && src.visible && !src.muted && src.volume > 0) {
          const jitter = 0.68 + Math.random() * 0.28;
          levels[src.id] = Math.min(1, src.volume * masterVolume * jitter);
        } else {
          levels[src.id] = 0;
        }
      }
      if (micEnabled && micVolume > 0) {
        levels['mic-aux'] = Math.min(1, micVolume * masterVolume * (0.5 + Math.random() * 0.45));
      } else {
        levels['mic-aux'] = 0;
      }
      setAudioMeterLevels(levels);
    }, 250);

    return () => clearInterval(interval);
  }, [
    selectedSourceId,
    programScene.sources,
    masterVolume,
    micEnabled,
    micVolume,
  ]);

  // Main 60 FPS Canvas Compositor Loop (renders Program Canvas and Preview Canvas)
  useEffect(() => {
    let animationFrameId: number;
    const startTime = performance.now();

    const renderLoop = (now: number) => {
      const elapsedSec = (now - startTime) / 1000;
      const avgAudio =
        Object.values(audioMeterLevels).reduce((acc, v) => acc + v, 0) /
        Math.max(1, Object.keys(audioMeterLevels).length);

      // 1. Render Program Canvas
      if (programCanvasRef.current) {
        const ctx = programCanvasRef.current.getContext('2d');
        if (ctx) {
          renderSceneToCanvas(
            ctx,
            programScene.sources,
            mediaRegistryRef.current,
            elapsedSec,
            avgAudio,
            studioMode ? null : selectedSourceId,
            !studioMode
          );

          // If transitioning in Studio Mode, blend preview scene on top
          if (studioMode && transitionAlpha > 0) {
            ctx.save();
            ctx.globalAlpha = transitionAlpha;
            renderSceneToCanvas(
              ctx,
              editingScene.sources,
              mediaRegistryRef.current,
              elapsedSec,
              avgAudio,
              null,
              false
            );
            ctx.restore();
          }
        }
      }

      // 2. Render Preview Canvas (when Studio Mode is enabled)
      if (studioMode && previewCanvasRef.current) {
        const prevCtx = previewCanvasRef.current.getContext('2d');
        if (prevCtx) {
          renderSceneToCanvas(
            prevCtx,
            editingScene.sources,
            mediaRegistryRef.current,
            elapsedSec,
            avgAudio,
            selectedSourceId,
            true
          );
        }
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);

    // Background tab keep-alive timer so YouTube Live never drops frames when operator switches to YouTube Studio tab
    const bgInterval = setInterval(() => {
      if (document.hidden) {
        renderLoop(performance.now());
      }
    }, 33);

    return () => {
      cancelAnimationFrame(animationFrameId);
      clearInterval(bgInterval);
    };
  }, [
    programScene,
    editingScene,
    studioMode,
    selectedSourceId,
    transitionAlpha,
    audioMeterLevels,
  ]);

  // Smooth Fade Transition in Studio Mode
  const handleStudioFadeTransition = () => {
    if (!studioMode) return;
    let step = 0;
    const totalSteps = 15;
    const timer = setInterval(() => {
      step += 1;
      setTransitionAlpha(step / totalSteps);
      if (step >= totalSteps) {
        clearInterval(timer);
        const oldProg = programSceneId;
        setProgramSceneId(previewSceneId);
        setPreviewSceneId(oldProg);
        setTransitionAlpha(0);
      }
    }, 25);
  };

  // Interactive Canvas Mouse Drag & Resize Handlers
  const getCanvasCoordinates = (
    e: React.MouseEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      cx: (e.clientX - rect.left) * scaleX,
      cy: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleCanvasMouseDown = (
    e: React.MouseEvent<HTMLCanvasElement>,
    isPreviewCanvas: boolean
  ) => {
    if (studioMode && !isPreviewCanvas) return; // In Studio Mode, edit layers on Preview canvas
    const canvas = e.currentTarget;
    const { cx, cy } = getCanvasCoordinates(e, canvas);

    // Check if user clicked bottom-right resize handle of currently selected source
    const currentSelected = editingScene.sources.find(
      (s) => s.id === selectedSourceId
    );
    if (currentSelected && currentSelected.visible && !currentSelected.locked) {
      const handleX = currentSelected.x + currentSelected.width;
      const handleY = currentSelected.y + currentSelected.height;
      if (Math.abs(cx - handleX) <= 28 && Math.abs(cy - handleY) <= 28) {
        dragStateRef.current = {
          mode: 'resize',
          sourceId: currentSelected.id,
          startX: cx,
          startY: cy,
          origX: currentSelected.x,
          origY: currentSelected.y,
          origW: currentSelected.width,
          origH: currentSelected.height,
        };
        return;
      }
    }

    // Find topmost unlocked visible source under cursor (iterate in reverse order)
    for (let i = editingScene.sources.length - 1; i >= 0; i--) {
      const src = editingScene.sources[i];
      if (!src.visible || src.locked) continue;
      if (
        cx >= src.x &&
        cx <= src.x + src.width &&
        cy >= src.y &&
        cy <= src.y + src.height
      ) {
        setSelectedSourceId(src.id);
        dragStateRef.current = {
          mode: 'move',
          sourceId: src.id,
          startX: cx,
          startY: cy,
          origX: src.x,
          origY: src.y,
          origW: src.width,
          origH: src.height,
        };
        return;
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    if (!drag.mode || !drag.sourceId) return;

    const { cx, cy } = getCanvasCoordinates(e, e.currentTarget);
    const dx = Math.round(cx - drag.startX);
    const dy = Math.round(cy - drag.startY);

    if (drag.mode === 'move') {
      updateSource(drag.sourceId, (s) => ({
        ...s,
        x: Math.max(-960, Math.min(1900, drag.origX + dx)),
        y: Math.max(-540, Math.min(1060, drag.origY + dy)),
      }));
    } else if (drag.mode === 'resize') {
      updateSource(drag.sourceId, (s) => ({
        ...s,
        width: Math.max(120, Math.min(1920, drag.origW + dx)),
        height: Math.max(68, Math.min(1080, drag.origH + dy)),
      }));
    }
  };

  const handleCanvasMouseUp = () => {
    dragStateRef.current.mode = null;
    dragStateRef.current.sourceId = null;
  };

  const selectedSource =
    editingScene.sources.find((s) => s.id === selectedSourceId) ||
    editingScene.sources[0] ||
    null;

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Hidden File Inputs for Video & Image Sources */}
      <input
        ref={videoFileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/ogg,video/quicktime,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleAddVideoFilesToScene(e.target.files, true);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleAddImageFile(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* TOP BAR CONTRACT: Strictly 1 row, 3 zones (Brand Wordmark — 4 Nav Links — 2 Primary Actions) */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-[#0E1420] border-b border-slate-800 shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#studio"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('studio');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap"
        >
          VoxelCast Studio
        </a>

        {/* Zone 2: 5 clean text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setActiveTab('studio')}
            className={`transition-colors whitespace-nowrap hover:text-slate-100 ${
              activeTab === 'studio'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : ''
            }`}
          >
            Estúdio Ao Vivo
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cloud247')}
            className={`transition-colors whitespace-nowrap hover:text-slate-100 ${
              activeTab === 'cloud247'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : ''
            }`}
          >
            Modo Nuvem 24/7
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('playlist')}
            className={`transition-colors whitespace-nowrap hover:text-slate-100 ${
              activeTab === 'playlist'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : ''
            }`}
          >
            Playlist de Vídeos
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rtmp')}
            className={`transition-colors whitespace-nowrap hover:text-slate-100 ${
              activeTab === 'rtmp'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : ''
            }`}
          >
            Destino YouTube RTMP
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            className={`transition-colors whitespace-nowrap hover:text-slate-100 ${
              activeTab === 'guide'
                ? 'text-slate-100 underline underline-offset-8 decoration-blue-500 decoration-2'
                : ''
            }`}
          >
            Arquitetura & Guia
          </button>
        </nav>

        {/* Zone 3: 2 primary actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleToggleLocalRecording}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
              streamStats.isRecordingLocal
                ? 'bg-amber-600/20 border-amber-500 text-amber-200'
                : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Disc
              className={`w-3.5 h-3.5 ${
                streamStats.isRecordingLocal ? 'text-amber-400 animate-spin' : 'text-slate-400'
              }`}
            />
            {streamStats.isRecordingLocal ? 'Parar Gravação' : 'Gravar Local'}
          </button>

          <button
            type="button"
            onClick={handleToggleLiveStream}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
              streamStats.isStreaming
                ? 'bg-red-700 text-white hover:bg-red-600'
                : 'bg-red-600 text-white hover:bg-red-500'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            {streamStats.isStreaming
              ? `Encerrar Live (${formatSecondsToTimecode(streamStats.elapsedSeconds)})`
              : 'Transmitir no YouTube'}
          </button>
        </div>
      </header>

      {/* Mobile Navigation Sub-bar */}
      <div className="flex md:hidden items-center gap-2 px-4 py-2 bg-[#111827] border-b border-slate-800 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('studio')}
          className={`px-3 py-1 text-xs font-medium rounded whitespace-nowrap ${
            activeTab === 'studio' ? 'bg-blue-600 text-white' : 'text-slate-400'
          }`}
        >
          Estúdio Ao Vivo
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('cloud247')}
          className={`px-3 py-1 text-xs font-medium rounded whitespace-nowrap ${
            activeTab === 'cloud247' ? 'bg-blue-600 text-white' : 'text-slate-400'
          }`}
        >
          Modo Nuvem 24/7
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('playlist')}
          className={`px-3 py-1 text-xs font-medium rounded whitespace-nowrap ${
            activeTab === 'playlist' ? 'bg-blue-600 text-white' : 'text-slate-400'
          }`}
        >
          Playlist de Vídeos
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('rtmp')}
          className={`px-3 py-1 text-xs font-medium rounded whitespace-nowrap ${
            activeTab === 'rtmp' ? 'bg-blue-600 text-white' : 'text-slate-400'
          }`}
        >
          Destino YouTube RTMP
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('guide')}
          className={`px-3 py-1 text-xs font-medium rounded whitespace-nowrap ${
            activeTab === 'guide' ? 'bg-blue-600 text-white' : 'text-slate-400'
          }`}
        >
          Arquitetura & Guia
        </button>
      </div>

      {/* MAIN VIEWPORT CONTENT */}
      {activeTab === 'cloud247' && (
        <main className="flex-1 overflow-y-auto">
          <CloudAutonomousView
            rtmpConfig={rtmpConfig}
            onUpdateRtmpConfig={setRtmpConfig}
            onReturnToStudio={() => setActiveTab('studio')}
          />
        </main>
      )}

      {activeTab === 'rtmp' && (
        <main className="flex-1 overflow-y-auto">
          <YouTubeRtmpModal
            config={rtmpConfig}
            onChange={setRtmpConfig}
            onStartStream={handleToggleLiveStream}
            isStreaming={streamStats.isStreaming}
            streamStats={streamStats}
            ffmpegLogs={ffmpegLogs}
            onClose={() => setActiveTab('studio')}
          />
        </main>
      )}

      {activeTab === 'playlist' && (
        <main className="flex-1 overflow-y-auto">
          <PlaylistManagerView
            items={playlist}
            activeItemId={activePlaylistItemId}
            onSelectAndPlay={handlePlayPlaylistItemInStudio}
            onAddLocalFiles={(files) => handleAddVideoFilesToScene(files, true)}
            onAddUrlVideo={handleAddUrlVideo}
            onRemoveItem={(id) =>
              setPlaylist((prev) => prev.filter((item) => item.id !== id))
            }
            onMoveItem={(index, direction) => {
              setPlaylist((prev) => {
                const copy = [...prev];
                const targetIdx = direction === 'up' ? index - 1 : index + 1;
                if (targetIdx < 0 || targetIdx >= copy.length) return prev;
                const [moved] = copy.splice(index, 1);
                copy.splice(targetIdx, 0, moved);
                return copy;
              });
            }}
            onToggleLoopItem={(id) =>
              setPlaylist((prev) =>
                prev.map((item) =>
                  item.id === id ? { ...item, loop: !item.loop } : item
                )
              )
            }
            rtmpConfig={rtmpConfig}
            onUpdateRtmpConfig={setRtmpConfig}
            onReturnToStudio={() => setActiveTab('studio')}
          />
        </main>
      )}

      {activeTab === 'guide' && (
        <main className="flex-1 overflow-y-auto">
          <ArchitectureGuideView
            onReturnToStudio={() => setActiveTab('studio')}
            onOpenRtmpSettings={() => setActiveTab('rtmp')}
          />
        </main>
      )}

      <main
        className={
          activeTab === 'studio'
            ? 'flex-1 flex flex-col max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-4 gap-4'
            : 'hidden'
        }
      >
        {/* STAGE 1: MONITOR CANVAS AREA (SINGLE PROGRAM OR STUDIO DUAL PREVIEW/PROGRAM) */}
          <section className="bg-[#111827] border border-slate-800 rounded-lg p-4">
            {/* Monitor Top Bar with Clean Unboxed Metadata */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="font-semibold text-slate-200">
                  {studioMode
                    ? `Modo Estúdio Duplo · Prévia: ${editingScene.name} / Programa: ${programScene.name}`
                    : `Cena no Ar: ${programScene.name}`}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {rtmpConfig.resolution}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{rtmpConfig.fps} FPS</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {streamStats.isStreaming
                    ? `AO VIVO (${streamStats.bitrateKbps || rtmpConfig.videoBitrateKbps} kbps)`
                    : rtmpConfig.mode === 'youtube'
                    ? 'Destino: YouTube Live RTMP'
                    : 'Destino: Modo Teste FFmpeg'}
                </span>
              </div>

              {/* Quick Studio Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setYoutubeStudioPlayer((prev) => ({
                      ...prev,
                      visible: !prev.visible,
                    }))
                  }
                  className={`px-3 py-1.5 text-xs font-semibold rounded border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                    youtubeStudioPlayer.visible
                      ? 'bg-red-600 border-red-500 text-white'
                      : 'bg-red-950/40 border-red-800/70 text-red-200 hover:bg-red-900/50'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  Player YouTube ({youtubeStudioPlayer.title})
                </button>

                <button
                  type="button"
                  onClick={() => videoFileInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-500 transition-colors flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Film className="w-3.5 h-3.5" />
                  + Adicionar Vídeo (.MP4 / .WebM)
                </button>

                <button
                  type="button"
                  onClick={() => setStudioMode((prev) => !prev)}
                  className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                    studioMode
                      ? 'bg-blue-950/60 border-blue-500 text-blue-200'
                      : 'bg-[#0B0F17] border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Columns className="w-3.5 h-3.5" />
                  Modo Estúdio (Prévia / Programa)
                </button>
              </div>
            </div>

            {/* Built-in YouTube Live Source Player Bar (Zero Weight on Server) */}
            {youtubeStudioPlayer.visible && (
              <div className="mb-4 p-3.5 bg-[#0B0F17] border border-red-900/60 rounded-lg grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                <div className="lg:col-span-5 aspect-video w-full rounded overflow-hidden border border-slate-800 bg-black">
                  <iframe
                    src={`https://www.youtube.com/embed/${youtubeStudioPlayer.videoId}?autoplay=1&loop=1&playlist=${youtubeStudioPlayer.videoId}&rel=0`}
                    title={youtubeStudioPlayer.title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <div className="lg:col-span-7 space-y-3">
                  <div>
                    <div className="text-xs font-mono text-red-400">
                      FONTE YOUTUBE DIRETA (ZERO PESO DE UPLOAD NO SITE)
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100 mt-0.5">
                      Vídeo Selecionado: {youtubeStudioPlayer.title} ({youtubeStudioPlayer.videoId})
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Para transmitir este vídeo direto do YouTube sem capturar a tela do seu computador nem sobrecarregar o site, use o <strong>Modo Nuvem 24/7</strong>. O servidor transmite o áudio e vídeo puros do YouTube para a sua Live via conexão RTMPS.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="url"
                      value={youtubeStudioPlayer.rawUrl}
                      onChange={async (e) => {
                        const val = e.target.value;
                        setYoutubeStudioPlayer((prev) => ({
                          ...prev,
                          rawUrl: val,
                        }));
                        try {
                          const r = await fetch(
                            `/api/youtube/info?url=${encodeURIComponent(val)}`
                          );
                          const d = await r.json();
                          if (r.ok && d.valid) {
                            setYoutubeStudioPlayer((prev) => ({
                              ...prev,
                              videoId: d.videoId,
                              title: `${d.title} (${d.authorName})`,
                            }));
                          }
                        } catch {
                          // ignore
                        }
                      }}
                      placeholder="Cole qualquer link do YouTube (ex: https://www.youtube.com/live/ZCKgoFyh2hI)"
                      className="flex-1 min-w-[240px] px-3 py-1.5 text-xs font-mono bg-[#111827] border border-slate-700 rounded text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => setActiveTab('cloud247')}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-500 transition-colors whitespace-nowrap flex items-center gap-1.5"
                    >
                      <Radio className="w-3.5 h-3.5" />
                      Transmitir no Modo Nuvem 24/7 (Sem Captura de Tela)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Canvas Viewport Grid */}
            <div
              className={`grid gap-4 items-center ${
                studioMode
                  ? 'grid-cols-1 lg:grid-cols-11'
                  : 'grid-cols-1 max-w-4xl mx-auto'
              }`}
            >
              {/* PREVIEW MONITOR (Only visible when Studio Mode is active) */}
              {studioMode && (
                <div className="lg:col-span-5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                    <span className="font-medium text-amber-400">
                      PRÉVIA (EDIÇÃO) · {editingScene.name}
                    </span>
                    <span className="font-mono text-[11px]">
                      Arraste camadas aqui
                    </span>
                  </div>
                  <div className="relative aspect-video w-full bg-black rounded border border-amber-500/40 overflow-hidden">
                    <canvas
                      ref={previewCanvasRef}
                      width={1920}
                      height={1080}
                      onMouseDown={(e) => handleCanvasMouseDown(e, true)}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={handleCanvasMouseUp}
                      className="w-full h-full object-contain cursor-move"
                    />
                  </div>
                </div>
              )}

              {/* STUDIO MODE TRANSITION CONTROLS */}
              {studioMode && (
                <div className="lg:col-span-1 flex lg:flex-col items-center justify-center gap-2 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      const oldProg = programSceneId;
                      setProgramSceneId(previewSceneId);
                      setPreviewSceneId(oldProg);
                    }}
                    className="w-full px-3 py-2 text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    Corte
                  </button>
                  <button
                    type="button"
                    onClick={handleStudioFadeTransition}
                    className="w-full px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-500 transition-colors whitespace-nowrap"
                  >
                    Fade 400ms
                  </button>
                </div>
              )}

              {/* PROGRAM MONITOR (Always rendered — captured by MediaRecorder & FFmpeg) */}
              <div className={studioMode ? 'lg:col-span-5 space-y-1.5' : 'w-full'}>
                {studioMode && (
                  <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                    <span className="font-medium text-red-400">
                      PROGRAMA (SAÍDA AO VIVO YOUTUBE) · {programScene.name}
                    </span>
                    <span className="font-mono tabular-nums text-[11px]">
                      {formatSecondsToTimecode(streamStats.elapsedSeconds)}
                    </span>
                  </div>
                )}
                <div
                  className={`relative aspect-video w-full bg-black rounded border overflow-hidden ${
                    streamStats.isStreaming
                      ? 'border-red-500/80'
                      : 'border-slate-800'
                  }`}
                >
                  <canvas
                    ref={programCanvasRef}
                    width={1920}
                    height={1080}
                    onMouseDown={(e) => handleCanvasMouseDown(e, false)}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseUp}
                    className={`w-full h-full object-contain ${
                      studioMode ? 'cursor-default' : 'cursor-move'
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Quick Layer Transformation & Playback Toolbar below Canvas */}
            {selectedSource && (
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="text-slate-400">Camada Selecionada:</span>
                  <strong className="text-slate-100">{selectedSource.name}</strong>
                  <span className="text-slate-500 font-mono tabular-nums">
                    · X:{selectedSource.x} Y:{selectedSource.y} ({selectedSource.width}x
                    {selectedSource.height})
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateSource(selectedSource.id, (s) => ({
                        ...s,
                        x: 0,
                        y: 0,
                        width: 1920,
                        height: 1080,
                      }))
                    }
                    className="px-2.5 py-1 text-xs text-slate-300 bg-[#0B0F17] border border-slate-700 rounded hover:bg-slate-800 flex items-center gap-1 whitespace-nowrap"
                  >
                    <Maximize2 className="w-3 h-3" />
                    Tela Cheia (1920x1080)
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateSource(selectedSource.id, (s) => ({
                        ...s,
                        x: 1310,
                        y: 630,
                        width: 544,
                        height: 306,
                        borderRadius: 12,
                        borderWidth: 3,
                      }))
                    }
                    className="px-2.5 py-1 text-xs text-slate-300 bg-[#0B0F17] border border-slate-700 rounded hover:bg-slate-800 flex items-center gap-1 whitespace-nowrap"
                  >
                    <PictureInPicture2 className="w-3 h-3" />
                    Miniatura PiP (Canto)
                  </button>

                  {selectedSource.type === 'video-file' && (
                    <button
                      type="button"
                      onClick={() => {
                        const v = mediaRegistryRef.current.videos.get(
                          selectedSource.id
                        );
                        if (v) {
                          if (v.paused) v.play().catch(() => {});
                          else v.pause();
                        }
                      }}
                      className="px-2.5 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-500 flex items-center gap-1 whitespace-nowrap"
                    >
                      {videoProgress.paused ? (
                        <>
                          <Play className="w-3 h-3" /> Reproduzir Vídeo
                        </>
                      ) : (
                        <>
                          <Pause className="w-3 h-3" /> Pausar Vídeo
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* STAGE 2: OBS STUDIO 4-DOCK WORKSPACE (SCENES, SOURCES, INSPECTOR, AUDIO MIXER & STREAM OUTPUT) */}
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 flex-1">
            {/* DOCK 1: CENAS (SCENES) — 3 columns */}
            <div className="xl:col-span-3 bg-[#111827] border border-slate-800 rounded-lg flex flex-col">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200">
                  01. Cenas do Estúdio
                </h2>
                <button
                  type="button"
                  onClick={() => setShowNewSceneInput((prev) => !prev)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nova Cena
                </button>
              </div>

              {showNewSceneInput && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newSceneName.trim()) return;
                    const id = `scene-${Date.now()}`;
                    const created: StudioScene = {
                      id,
                      name: newSceneName.trim(),
                      description: 'Cena personalizada pelo operador.',
                      sources: [
                        {
                          id: `src-bg-${Date.now()}`,
                          name: 'Vídeo Base Sintético HD',
                          type: 'video-synth',
                          synthPreset: 'lofi-cyber-grid',
                          visible: true,
                          locked: false,
                          x: 0,
                          y: 0,
                          width: 1920,
                          height: 1080,
                          opacity: 1,
                          borderRadius: 0,
                          borderColor: '#3B82F6',
                          borderWidth: 0,
                          hasAudio: true,
                          volume: 0.8,
                          muted: false,
                          loop: true,
                          playbackRate: 1,
                        },
                      ],
                    };
                    setScenes((prev) => [...prev, created]);
                    if (studioMode) setPreviewSceneId(id);
                    else setProgramSceneId(id);
                    setNewSceneName('');
                    setShowNewSceneInput(false);
                  }}
                  className="p-3 border-b border-slate-800 flex gap-2 bg-[#0B0F17]"
                >
                  <input
                    type="text"
                    value={newSceneName}
                    onChange={(e) => setNewSceneName(e.target.value)}
                    placeholder="Nome da nova cena..."
                    className="flex-1 px-2.5 py-1.5 text-xs bg-[#111827] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-500"
                  >
                    Criar
                  </button>
                </form>
              )}

              <div className="p-2.5 space-y-1.5 flex-1 overflow-y-auto max-h-80">
                {scenes.map((scene) => {
                  const isProg = scene.id === programSceneId;
                  const isPrev = studioMode && scene.id === previewSceneId;
                  return (
                    <div
                      key={scene.id}
                      onClick={() => {
                        if (studioMode) {
                          setPreviewSceneId(scene.id);
                        } else {
                          setProgramSceneId(scene.id);
                        }
                        setSelectedSourceId(scene.sources[0]?.id || null);
                      }}
                      className={`p-2.5 rounded border cursor-pointer transition-colors ${
                        isProg
                          ? 'bg-blue-950/35 border-blue-500/70 text-slate-100'
                          : isPrev
                          ? 'bg-amber-950/25 border-amber-500/60 text-slate-100'
                          : 'bg-[#0B0F17]/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold truncate">
                          {scene.name}
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                          {isProg
                            ? 'NO AR'
                            : isPrev
                            ? 'PRÉVIA'
                            : `${scene.sources.length} fontes`}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                        {scene.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* DOCK 2: FONTES DA CENA (SOURCES / LAYERS) — 3 columns */}
            <div className="xl:col-span-3 bg-[#111827] border border-slate-800 rounded-lg flex flex-col">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200">
                  02. Fontes & Camadas ({editingScene.sources.length})
                </h2>
                <span className="text-[11px] text-slate-400">
                  Topo = Frente
                </span>
              </div>

              {/* Add Source Toolbar */}
              <div className="p-2.5 border-b border-slate-800 grid grid-cols-3 gap-1.5 bg-[#0E1420]">
                <button
                  type="button"
                  onClick={() => videoFileInputRef.current?.click()}
                  className="px-2 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800/90 border border-slate-700 rounded hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                  title="Adicionar arquivo de vídeo .MP4 ou .WebM do computador"
                >
                  <Video className="w-3.5 h-3.5" />
                  + Vídeo MP4
                </button>

                <button
                  type="button"
                  onClick={handleAddWebcamSource}
                  className="px-2 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800/90 border border-slate-700 rounded hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                  title="Adicionar câmera / webcam ao vivo"
                >
                  <Camera className="w-3.5 h-3.5" />
                  + Webcam
                </button>

                <button
                  type="button"
                  onClick={() => handleAddScreenShareSource()}
                  className="px-2 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800/90 border border-slate-700 rounded hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                  title="Compartilhar tela ou janela de aplicativo"
                >
                  <Monitor className="w-3.5 h-3.5" />
                  + Tela
                </button>

                <button
                  type="button"
                  onClick={handleAddLowerThird}
                  className="px-2 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800/90 border border-slate-700 rounded hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                  title="Adicionar tarja de texto / título sobreposto"
                >
                  <Type className="w-3.5 h-3.5" />
                  + Tarja Texto
                </button>

                <button
                  type="button"
                  onClick={() => imageFileInputRef.current?.click()}
                  className="px-2 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800/90 border border-slate-700 rounded hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                  title="Adicionar logo ou imagem transparente PNG/JPG"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  + Logo/Img
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('playlist')}
                  className="px-2 py-1.5 text-[11px] font-medium text-blue-300 bg-blue-950/40 border border-blue-800/70 rounded hover:bg-blue-900/60 transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <Film className="w-3.5 h-3.5" />
                  Ver Playlist
                </button>
              </div>

              {/* Layer List (Reversed visually so top layer is at the top of the list, just like OBS Studio) */}
              <div className="p-2.5 space-y-1.5 flex-1 overflow-y-auto max-h-72">
                {[...editingScene.sources]
                  .map((src, idx) => ({ src, idx }))
                  .reverse()
                  .map(({ src, idx }) => {
                    const isSelected = src.id === selectedSource?.id;
                    return (
                      <div
                        key={src.id}
                        onClick={() => setSelectedSourceId(src.id)}
                        className={`px-2.5 py-2 rounded border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-950/40 border-blue-500/70 text-slate-100'
                            : 'bg-[#0B0F17]/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">
                            {src.name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {src.type === 'video-file'
                              ? 'Arquivo de Vídeo MP4/WebM'
                              : src.type === 'video-synth'
                              ? 'Sinal de Vídeo Contínuo'
                              : src.type === 'webcam'
                              ? 'Câmera USB / Integrada'
                              : src.type === 'screen'
                              ? 'Captura de Tela'
                              : src.type === 'lower-third'
                              ? 'Tarja Broadcast'
                              : src.type === 'ticker'
                              ? 'Rodapé Dinâmico'
                              : 'Camada Visual'}
                          </div>
                        </div>

                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              updateSource(src.id, (s) => ({
                                ...s,
                                visible: !s.visible,
                              }))
                            }
                            title={
                              src.visible ? 'Ocultar camada' : 'Mostrar camada'
                            }
                            className={`p-1 rounded ${
                              src.visible
                                ? 'text-slate-300 hover:text-white'
                                : 'text-slate-600 hover:text-slate-400'
                            }`}
                          >
                            {src.visible ? (
                              <Eye className="w-3.5 h-3.5" />
                            ) : (
                              <EyeOff className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              updateSource(src.id, (s) => ({
                                ...s,
                                locked: !s.locked,
                              }))
                            }
                            title={
                              src.locked
                                ? 'Desbloquear posição'
                                : 'Bloquear posição no monitor'
                            }
                            className={`p-1 rounded ${
                              src.locked
                                ? 'text-amber-400'
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            {src.locked ? (
                              <Lock className="w-3.5 h-3.5" />
                            ) : (
                              <Unlock className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={idx === editingScene.sources.length - 1}
                            onClick={() => {
                              setScenes((prev) =>
                                prev.map((sc) => {
                                  if (sc.id !== editingSceneId) return sc;
                                  const arr = [...sc.sources];
                                  const [item] = arr.splice(idx, 1);
                                  arr.splice(idx + 1, 0, item);
                                  return { ...sc, sources: arr };
                                })
                              );
                            }}
                            title="Trazer para frente"
                            className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-25"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => {
                              setScenes((prev) =>
                                prev.map((sc) => {
                                  if (sc.id !== editingSceneId) return sc;
                                  const arr = [...sc.sources];
                                  const [item] = arr.splice(idx, 1);
                                  arr.splice(idx - 1, 0, item);
                                  return { ...sc, sources: arr };
                                })
                              );
                            }}
                            title="Enviar para trás"
                            className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-25"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>

                          {editingScene.sources.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                setScenes((prev) =>
                                  prev.map((sc) =>
                                    sc.id === editingSceneId
                                      ? {
                                          ...sc,
                                          sources: sc.sources.filter(
                                            (s) => s.id !== src.id
                                          ),
                                        }
                                      : sc
                                  )
                                );
                              }}
                              title="Remover camada"
                              className="p-1 text-slate-500 hover:text-red-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* DOCK 3: PROPRIEDADES DA FONTE & PLAYER DE VÍDEO — 3 columns */}
            <div className="xl:col-span-3 bg-[#111827] border border-slate-800 rounded-lg flex flex-col">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-blue-400" />
                  03. Propriedades da Camada
                </h2>
                {selectedSource && (
                  <span className="text-[11px] font-mono text-slate-400 truncate max-w-[130px]">
                    {selectedSource.name}
                  </span>
                )}
              </div>

              {selectedSource ? (
                <div className="p-3.5 space-y-3.5 flex-1 overflow-y-auto max-h-80 text-xs">
                  {/* Video File / Video Synth specific controls */}
                  {(selectedSource.type === 'video-file' ||
                    selectedSource.type === 'video-synth') && (
                    <div className="space-y-3 pb-3 border-b border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 font-medium">
                          Fonte de Vídeo Ativa
                        </span>
                        <button
                          type="button"
                          onClick={() => videoFileInputRef.current?.click()}
                          className="text-blue-400 hover:text-blue-300 font-medium"
                        >
                          Trocar por .MP4 Local
                        </button>
                      </div>

                      {selectedSource.type === 'video-synth' && (
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Sinal de Vídeo Gerado (Ou carregue um arquivo .MP4 acima)
                          </label>
                          <select
                            value={selectedSource.synthPreset || 'lofi-cyber-grid'}
                            onChange={(e) =>
                              updateSource(selectedSource.id, (s) => ({
                                ...s,
                                synthPreset: e.target.value as SynthPresetId,
                              }))
                            }
                            className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-700 rounded text-slate-200"
                          >
                            <option value="lofi-cyber-grid">
                              Equalizador & Grade Sintética 60 FPS
                            </option>
                            <option value="countdown-studio">
                              Contagem Regressiva de Abertura (05:00)
                            </option>
                            <option value="ambient-waves">
                              Ondas Harmônicas (Canal 24/7)
                            </option>
                            <option value="breaking-news-bg">
                              Fundo Radar & Telemetria Jornalismo
                            </option>
                          </select>
                        </div>
                      )}

                      {selectedSource.type === 'video-file' && (
                        <div className="space-y-2 bg-[#0B0F17] p-2.5 rounded border border-slate-800">
                          <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-slate-300">
                            <span>
                              {formatSecondsToTimecode(videoProgress.currentTime)}
                            </span>
                            <span>
                              {formatSecondsToTimecode(videoProgress.duration)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={Math.max(1, videoProgress.duration)}
                            step={0.5}
                            value={videoProgress.currentTime}
                            onChange={(e) => {
                              const nextTime = Number(e.target.value);
                              const v = mediaRegistryRef.current.videos.get(
                                selectedSource.id
                              );
                              if (v) {
                                v.currentTime = nextTime;
                                setVideoProgress((prev) => ({
                                  ...prev,
                                  currentTime: nextTime,
                                }));
                              }
                            }}
                            className="w-full accent-blue-500"
                          />
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  const v = mediaRegistryRef.current.videos.get(
                                    selectedSource.id
                                  );
                                  if (v) {
                                    if (v.paused) v.play().catch(() => {});
                                    else v.pause();
                                  }
                                }}
                                className="px-2.5 py-1 bg-blue-600 text-white rounded text-[11px] font-medium flex items-center gap-1"
                              >
                                {videoProgress.paused ? (
                                  <>
                                    <Play className="w-3 h-3" /> Play
                                  </>
                                ) : (
                                  <>
                                    <Pause className="w-3 h-3" /> Pause
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  updateSource(selectedSource.id, (s) => ({
                                    ...s,
                                    loop: !s.loop,
                                  }))
                                }
                                className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 ${
                                  selectedSource.loop
                                    ? 'border-blue-500/60 text-blue-300 bg-blue-950/30'
                                    : 'border-slate-700 text-slate-400'
                                }`}
                              >
                                <Repeat className="w-3 h-3" />
                                Loop
                              </button>
                            </div>

                            <select
                              value={selectedSource.playbackRate || 1}
                              onChange={(e) =>
                                updateSource(selectedSource.id, (s) => ({
                                  ...s,
                                  playbackRate: Number(e.target.value),
                                }))
                              }
                              className="px-2 py-1 text-[11px] font-mono bg-[#111827] border border-slate-700 rounded text-slate-200"
                            >
                              <option value={0.5}>0.5x</option>
                              <option value={1}>1.0x</option>
                              <option value={1.25}>1.25x</option>
                              <option value={1.5}>1.5x</option>
                              <option value={2}>2.0x</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Lower Third / Ticker Text Editor */}
                  {(selectedSource.type === 'lower-third' ||
                    selectedSource.type === 'ticker') && (
                    <div className="space-y-2.5 pb-3 border-b border-slate-800">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Texto Principal Ao Vivo
                        </label>
                        <input
                          type="text"
                          value={selectedSource.primaryText || ''}
                          onChange={(e) =>
                            updateSource(selectedSource.id, (s) => ({
                              ...s,
                              primaryText: e.target.value,
                            }))
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      {selectedSource.type === 'lower-third' && (
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Subtítulo / Linha Auxiliar
                          </label>
                          <input
                            type="text"
                            value={selectedSource.secondaryText || ''}
                            onChange={(e) =>
                              updateSource(selectedSource.id, (s) => ({
                                ...s,
                                secondaryText: e.target.value,
                              }))
                            }
                            className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Cor de Destaque
                          </label>
                          <input
                            type="color"
                            value={selectedSource.accentColor || '#DC2626'}
                            onChange={(e) =>
                              updateSource(selectedSource.id, (s) => ({
                                ...s,
                                accentColor: e.target.value,
                              }))
                            }
                            className="w-full h-7 bg-[#0B0F17] border border-slate-700 rounded cursor-pointer"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Tamanho da Fonte (px)
                          </label>
                          <input
                            type="number"
                            min={16}
                            max={64}
                            value={selectedSource.fontSize || 28}
                            onChange={(e) =>
                              updateSource(selectedSource.id, (s) => ({
                                ...s,
                                fontSize: Number(e.target.value),
                              }))
                            }
                            className="w-full px-2.5 py-1 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Geometry & Opacity Controls */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Posição X (px)
                      </label>
                      <input
                        type="number"
                        value={selectedSource.x}
                        onChange={(e) =>
                          updateSource(selectedSource.id, (s) => ({
                            ...s,
                            x: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2.5 py-1 text-xs font-mono tabular-nums bg-[#0B0F17] border border-slate-700 rounded text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Posição Y (px)
                      </label>
                      <input
                        type="number"
                        value={selectedSource.y}
                        onChange={(e) =>
                          updateSource(selectedSource.id, (s) => ({
                            ...s,
                            y: Number(e.target.value),
                          }))
                        }
                        className="w-full px-2.5 py-1 text-xs font-mono tabular-nums bg-[#0B0F17] border border-slate-700 rounded text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Largura (px)
                      </label>
                      <input
                        type="number"
                        value={selectedSource.width}
                        onChange={(e) =>
                          updateSource(selectedSource.id, (s) => ({
                            ...s,
                            width: Math.max(80, Number(e.target.value)),
                          }))
                        }
                        className="w-full px-2.5 py-1 text-xs font-mono tabular-nums bg-[#0B0F17] border border-slate-700 rounded text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Altura (px)
                      </label>
                      <input
                        type="number"
                        value={selectedSource.height}
                        onChange={(e) =>
                          updateSource(selectedSource.id, (s) => ({
                            ...s,
                            height: Math.max(48, Number(e.target.value)),
                          }))
                        }
                        className="w-full px-2.5 py-1 text-xs font-mono tabular-nums bg-[#0B0F17] border border-slate-700 rounded text-slate-200"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Opacidade da Camada</span>
                      <span className="font-mono tabular-nums">
                        {Math.round(selectedSource.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={selectedSource.opacity}
                      onChange={(e) =>
                        updateSource(selectedSource.id, (s) => ({
                          ...s,
                          opacity: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-blue-500"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-slate-400">
                  Selecione uma camada na lista ao lado ou clique diretamente no monitor para editar.
                </div>
              )}
            </div>

            {/* DOCK 4: MIXER DE ÁUDIO & SAÍDA YOUTUBE LIVE — 3 columns */}
            <div className="xl:col-span-3 bg-[#111827] border border-slate-800 rounded-lg flex flex-col">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-200">
                  04. Mixer de Áudio & Saída RTMP
                </h2>
                <button
                  type="button"
                  onClick={handleToggleMicrophone}
                  className={`px-2 py-1 text-[11px] font-medium rounded border flex items-center gap-1 transition-colors ${
                    micEnabled
                      ? 'bg-emerald-950/50 border-emerald-600 text-emerald-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {micEnabled ? (
                    <>
                      <Mic className="w-3 h-3 text-emerald-400" /> Mic Ativo
                    </>
                  ) : (
                    <>
                      <MicOff className="w-3 h-3 text-slate-400" /> + Ativar Mic
                    </>
                  )}
                </button>
              </div>

              <div className="p-3.5 space-y-3 flex-1 overflow-y-auto max-h-80 text-xs">
                {/* Master Audio Fader */}
                <div className="pb-2.5 border-b border-slate-800">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-slate-200">
                      Saída Master (Bus Principal)
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">
                      {Math.round(masterVolume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1.2}
                    step={0.05}
                    value={masterVolume}
                    onChange={(e) => setMasterVolume(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </div>

                {/* Microphone Channel if enabled */}
                {micEnabled && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-emerald-300 font-medium truncate">
                        Microfone Auxiliar Ao Vivo
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-400">
                        {Math.round(micVolume * 100)}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-[#0B0F17] rounded overflow-hidden border border-slate-800">
                      <div
                        className="h-full bg-emerald-500 transition-transform duration-100 origin-left"
                        style={{
                          transform: `scaleX(${audioMeterLevels['mic-aux'] || 0.05})`,
                        }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.05}
                      value={micVolume}
                      onChange={(e) => setMicVolume(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                )}

                {/* Per-Source Audio Channels */}
                {programScene.sources
                  .filter((s) => s.hasAudio)
                  .map((src) => {
                    const level = audioMeterLevels[src.id] || 0;
                    const dbValue =
                      level <= 0.01
                        ? '-∞ dB'
                        : `${(20 * Math.log10(level)).toFixed(1)} dB`;
                    return (
                      <div key={src.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-300 truncate">{src.name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono tabular-nums text-[11px] text-slate-400">
                              {dbValue}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setScenes((prev) =>
                                  prev.map((sc) =>
                                    sc.id === programScene.id
                                      ? {
                                          ...sc,
                                          sources: sc.sources.map((item) =>
                                            item.id === src.id
                                              ? { ...item, muted: !item.muted }
                                              : item
                                          ),
                                        }
                                      : sc
                                  )
                                )
                              }
                              className={`p-1 rounded ${
                                src.muted
                                  ? 'text-red-400 bg-red-950/30'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {src.muted ? (
                                <VolumeX className="w-3.5 h-3.5" />
                              ) : (
                                <Volume2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* VU Meter Bar using transform scaleX */}
                        <div className="h-2 w-full bg-[#0B0F17] rounded overflow-hidden border border-slate-800">
                          <div
                            className={`h-full transition-transform duration-100 origin-left ${
                              level > 0.85
                                ? 'bg-red-500'
                                : level > 0.65
                                ? 'bg-amber-400'
                                : 'bg-emerald-500'
                            }`}
                            style={{ transform: `scaleX(${Math.max(0.02, level)})` }}
                          />
                        </div>

                        <input
                          type="range"
                          min={0}
                          max={1.2}
                          step={0.05}
                          value={src.muted ? 0 : src.volume}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setScenes((prev) =>
                              prev.map((sc) =>
                                sc.id === programScene.id
                                  ? {
                                      ...sc,
                                      sources: sc.sources.map((item) =>
                                        item.id === src.id
                                          ? { ...item, volume: val, muted: val === 0 }
                                          : item
                                      ),
                                    }
                                  : sc
                              )
                            );
                          }}
                          className="w-full accent-blue-500"
                        />
                      </div>
                    );
                  })}

                {/* Live RTMP & Recording Summary Box */}
                <div className="pt-3 border-t border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Estado do Codificador:</span>
                    <span
                      className={`font-mono font-medium ${
                        streamStats.isStreaming
                          ? 'text-emerald-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {streamStats.isStreaming
                        ? 'TRANSMITINDO (FFMPEG ATIVO)'
                        : 'EM ESPERA'}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-snug">
                    {streamStats.statusMessage}
                  </p>

                  {streamStats.isStreaming && (
                    <div className="grid grid-cols-2 gap-2 pt-1 font-mono tabular-nums text-[11px] text-slate-300">
                      <div>
                        Quadros: <strong>{streamStats.framesSent}</strong>
                      </div>
                      <div>
                        Dados:{' '}
                        <strong>
                          {(streamStats.bytesTransferred / (1024 * 1024)).toFixed(2)} MB
                        </strong>
                      </div>
                    </div>
                  )}

                  {recordedVideoUrl && (
                    <a
                      href={recordedVideoUrl}
                      download={recordedFileName}
                      className="w-full mt-2 px-3 py-2 text-xs font-semibold text-emerald-200 bg-emerald-950/60 border border-emerald-700 rounded flex items-center justify-center gap-1.5 hover:bg-emerald-900/60 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Baixar Gravação (.WebM)
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveTab('rtmp')}
                    className="w-full mt-1 px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#0B0F17] border border-slate-700 rounded hover:bg-slate-800 transition-colors"
                  >
                    Configurar Chave do YouTube Live
                  </button>
                </div>
              </div>
            </div>
          </section>
      </main>
    </div>
  );
}
