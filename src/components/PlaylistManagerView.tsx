import React, { useRef, useState } from 'react';
import {
  Upload,
  Play,
  Trash2,
  ArrowUp,
  ArrowDown,
  Repeat,
  Film,
  Link as LinkIcon,
  Plus,
} from 'lucide-react';
import { PlaylistVideoItem, YouTubeRtmpConfig } from '../types/studio';

interface PlaylistManagerViewProps {
  items: PlaylistVideoItem[];
  activeItemId: string;
  onSelectAndPlay: (item: PlaylistVideoItem) => void;
  onAddLocalFiles: (files: FileList) => void;
  onAddUrlVideo: (title: string, url: string) => void;
  onRemoveItem: (id: string) => void;
  onMoveItem: (index: number, direction: 'up' | 'down') => void;
  onToggleLoopItem: (id: string) => void;
  rtmpConfig: YouTubeRtmpConfig;
  onUpdateRtmpConfig: (config: YouTubeRtmpConfig) => void;
  onReturnToStudio: () => void;
}

export const PlaylistManagerView: React.FC<PlaylistManagerViewProps> = ({
  items,
  activeItemId,
  onSelectAndPlay,
  onAddLocalFiles,
  onAddUrlVideo,
  onRemoveItem,
  onMoveItem,
  onToggleLoopItem,
  rtmpConfig,
  onUpdateRtmpConfig,
  onReturnToStudio,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = items.filter((item) =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;
    onAddUrlVideo(
      customTitle.trim() || `Vídeo Externo (${customUrl.split('/').pop() || 'MP4'})`,
      customUrl.trim()
    );
    setCustomTitle('');
    setCustomUrl('');
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 tracking-tight">
            Playlist de Vídeos & Fila de Reprodução (VLC / Fonte de Mídia OBS)
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Carregue vídeos gravados (.MP4, .WebM, .MOV) do seu computador para transmitir em sequência ou em loop contínuo como uma Live no YouTube.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/ogg,video/quicktime,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAddLocalFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            Adicionar Vídeos do Computador
          </button>
          <button
            type="button"
            onClick={onReturnToStudio}
            className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Ir para o Monitor do Estúdio
          </button>
        </div>
      </div>

      {/* Add Direct Video URL & Auto-Advance Controls */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleUrlSubmit}
          className="lg:col-span-8 bg-[#111827] border border-slate-800 rounded-lg p-4 flex flex-col sm:flex-row gap-3 items-end"
        >
          <div className="w-full sm:w-5/12">
            <label className="block text-xs text-slate-400 mb-1">
              Título do Vídeo na Fila
            </label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Ex: Aula 01 — Introdução"
              className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="w-full sm:w-5/12">
            <label className="block text-xs text-slate-400 mb-1">
              URL Direta do Vídeo (.mp4 ou .webm)
            </label>
            <input
              type="url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://exemplo.com/meu-video.mp4"
              className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="submit"
            className="w-full sm:w-auto px-4 py-2 text-xs font-medium text-slate-100 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Inserir URL
          </button>
        </form>

        <div className="lg:col-span-4 bg-[#111827] border border-slate-800 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-200">
              Avanço Automático de Playlist (24/7)
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Ao concluir um vídeo .MP4, inicia o próximo da fila automaticamente
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              onUpdateRtmpConfig({
                ...rtmpConfig,
                autoLoopPlaylist: !rtmpConfig.autoLoopPlaylist,
              })
            }
            className={`px-3 py-1.5 text-xs font-mono font-medium rounded border transition-colors whitespace-nowrap ${
              rtmpConfig.autoLoopPlaylist
                ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
          >
            {rtmpConfig.autoLoopPlaylist ? 'ATIVO' : 'DESATIVADO'}
          </button>
        </div>
      </div>

      {/* Filter & Queue Table */}
      <div className="mt-6 bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-slate-400">
            <span className="font-semibold text-slate-200">{filteredItems.length}</span> vídeos na fila de reprodução · Clique em <strong>Reproduzir no Estúdio</strong> para injetar na cena atual
          </div>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar vídeos pelo título..."
            className="w-full sm:w-64 px-3 py-1.5 text-xs bg-[#0B0F17] border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>

        {filteredItems.length === 0 ? (
          <div className="py-14 px-6 text-center">
            <Film className="w-8 h-8 text-slate-500 mx-auto mb-3" />
            <div className="text-sm font-medium text-slate-200">
              Nenhum vídeo encontrado na fila de transmissão
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Adicione arquivos .MP4 ou .WebM do seu computador para transmiti-los ao vivo para o YouTube sem precisar instalar nada no computador.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors"
            >
              Selecionar Arquivo de Vídeo (.MP4)
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#0E1420]">
                  <th className="py-2.5 px-4 w-12">#</th>
                  <th className="py-2.5 px-4">Título do Vídeo</th>
                  <th className="py-2.5 px-4">Origem / Formato</th>
                  <th className="py-2.5 px-4 text-right">Resolução</th>
                  <th className="py-2.5 px-4 text-right">Duração / Modo</th>
                  <th className="py-2.5 px-4 text-right">Ações de Transmissão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {filteredItems.map((item, idx) => {
                  const isCurrent = item.id === activeItemId;
                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isCurrent
                          ? 'bg-blue-950/30 text-slate-100'
                          : 'hover:bg-slate-800/40 text-slate-300'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-400">
                        {String(idx + 1).padStart(2, '0')}
                      </td>
                      <td className="py-3 px-4 font-medium">
                        <div className="flex items-center gap-2">
                          <span className="truncate max-w-md">{item.title}</span>
                          {isCurrent && (
                            <span className="text-[11px] font-mono text-blue-400 shrink-0">
                              · NO AR NO MONITOR
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {item.sourceType === 'local-file'
                          ? `Arquivo Local · ${item.fileSizeLabel}`
                          : `Gerador Estúdio · ${item.fileSizeLabel}`}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                        {item.resolutionLabel}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                        {item.durationLabel}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectAndPlay(item)}
                            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                              isCurrent
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-800 text-slate-200 hover:bg-blue-600 hover:text-white'
                            }`}
                          >
                            <Play className="w-3.5 h-3.5" />
                            {isCurrent ? 'Ativo no Monitor' : 'Tocar no Estúdio'}
                          </button>

                          <button
                            type="button"
                            onClick={() => onToggleLoopItem(item.id)}
                            title="Alternar repetição (Loop) deste vídeo"
                            className={`p-1.5 rounded border transition-colors ${
                              item.loop
                                ? 'bg-slate-800 border-blue-500/60 text-blue-400'
                                : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            <Repeat className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onMoveItem(idx, 'up')}
                            disabled={idx === 0}
                            title="Mover para cima"
                            className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onMoveItem(idx, 'down')}
                            disabled={idx === filteredItems.length - 1}
                            title="Mover para baixo"
                            className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>

                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onRemoveItem(item.id)}
                              title="Remover da playlist"
                              className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-red-400 hover:border-red-900/60"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
