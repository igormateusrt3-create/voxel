export type SourceType =
  | 'video-file'
  | 'video-synth'
  | 'webcam'
  | 'screen'
  | 'image'
  | 'lower-third'
  | 'ticker'
  | 'color-backdrop';

export type SynthPresetId =
  | 'countdown-studio'
  | 'lofi-cyber-grid'
  | 'breaking-news-bg'
  | 'ambient-waves';

export interface StudioSource {
  id: string;
  name: string;
  type: SourceType;
  visible: boolean;
  locked: boolean;
  // Normalized canvas coordinates (0 to 1920 width, 0 to 1080 height)
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  borderRadius: number;
  borderColor: string;
  borderWidth: number;
  // Audio properties (for video-file, video-synth, webcam, screen)
  hasAudio: boolean;
  volume: number; // 0 to 1.5
  muted: boolean;
  // Video / Media specific
  mediaUrl?: string;
  fileName?: string;
  loop?: boolean;
  playbackRate?: number;
  synthPreset?: SynthPresetId;
  // Lower third / Text overlay specific
  primaryText?: string;
  secondaryText?: string;
  accentColor?: string;
  textColor?: string;
  fontSize?: number;
  // Color backdrop specific
  gradientStart?: string;
  gradientEnd?: string;
}

export interface StudioScene {
  id: string;
  name: string;
  description: string;
  sources: StudioSource[];
}

export interface PlaylistVideoItem {
  id: string;
  title: string;
  durationLabel: string;
  sourceType: 'local-file' | 'synth-clip';
  mediaUrl?: string;
  synthPreset?: SynthPresetId;
  loop: boolean;
  fileSizeLabel: string;
  resolutionLabel: string;
}

export interface YouTubeRtmpConfig {
  mode: 'youtube' | 'simulation';
  ingestServerUrl: string;
  streamKey: string;
  resolution: '1920x1080' | '1280x720';
  fps: 30 | 60;
  videoBitrateKbps: number;
  audioBitrateKbps: 128 | 160 | 192;
  autoLoopPlaylist: boolean;
}

export interface StreamStats {
  isStreaming: boolean;
  isRecordingLocal: boolean;
  elapsedSeconds: number;
  framesSent: number;
  currentFps: number;
  bitrateKbps: number;
  bytesTransferred: number;
  ffmpegTime: string;
  connectionState: 'idle' | 'connecting' | 'live' | 'error';
  statusMessage: string;
}
