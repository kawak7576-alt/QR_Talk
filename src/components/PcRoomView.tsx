import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  ImagePlus,
  Maximize2,
  Monitor,
  Send,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
  type ChatImage,
  type ChatMessage,
} from '../types/chat';
import { useRoomSocket } from '../hooks/useRoomSocket';
import {
  copyChatImageToClipboard,
  downloadChatImage,
  processImageFile,
} from '../utils/imageProcessor';
import { QrCodeDisplay } from './QrCodeDisplay';

interface PcRoomViewProps {
  roomId: string;
  roomUrl: string;
  onCreateNewRoom: () => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function PcRoomView({ roomId, roomUrl, onCreateNewRoom }: PcRoomViewProps) {
  const {
    messages,
    connections,
    otherTypingUsers,
    status,
    errorMessage,
    clearError,
    sendMessage,
    sendTyping,
    deleteMessage,
    clearRoom,
  } = useRoomSocket({
    roomId,
    role: 'pc',
    senderName: 'PC',
  });

  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedImageId, setCopiedImageId] = useState<string | null>(null);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<ChatImage | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    setConfirmClear(false);
  }, [roomId]);

  useEffect(() => {
    if (!previewImage) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewImage(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewImage]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Clipboard fallback ignored if blocked
    }
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopiedMessageId(msg.id);
      window.setTimeout(() => {
        setCopiedMessageId((prev) => (prev === msg.id ? null : prev));
      }, 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleDownloadZip = async () => {
    if (isDownloadingZip) return;
    setIsDownloadingZip(true);
    try {
      const response = await fetch('/api/download-zip');
      if (!response.ok) {
        throw new Error('Download failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'qr-talk-app.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // ignore failed download silently or keep UI responsive
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleCopyImage = async (img: ChatImage) => {
    const ok = await copyChatImageToClipboard(img);
    if (ok) {
      setCopiedImageId(img.id);
      window.setTimeout(() => {
        setCopiedImageId((prev) => (prev === img.id ? null : prev));
      }, 1800);
    }
  };

  const addImageFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    const remainingSlots = MAX_IMAGES_PER_MESSAGE - pendingImages.length;
    if (remainingSlots <= 0) {
      setLocalError(`画像は一度に${MAX_IMAGES_PER_MESSAGE}枚まで送信できます。`);
      return;
    }

    const targets = fileArray.slice(0, remainingSlots);
    if (fileArray.length > remainingSlots) {
      setLocalError(
        `画像は一度に${MAX_IMAGES_PER_MESSAGE}枚まで添付できます（先頭${remainingSlots}枚を追加しました）。`
      );
    } else {
      setLocalError(null);
    }

    setIsProcessingImages(true);
    try {
      const processed: ChatImage[] = [];
      for (const file of targets) {
        processed.push(await processImageFile(file));
      }
      setPendingImages((prev) => [...prev, ...processed].slice(0, MAX_IMAGES_PER_MESSAGE));
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : '画像の読み込みに失敗しました。'
      );
    } finally {
      setIsProcessingImages(false);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addImageFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      await addImageFiles(imageFiles);
    }
  };

  const handleDrop = async (e: DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      await addImageFiles(e.dataTransfer.files);
    }
  };

  const handleDraftChange = (value: string) => {
    const clipped = value.slice(0, MAX_MESSAGE_LENGTH);
    setDraft(clipped);
    setLocalError(null);
    if (errorMessage) clearError();

    if (clipped.trim().length > 0) {
      sendTyping(true);
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = window.setTimeout(() => {
        sendTyping(false);
      }, 1500);
    } else {
      sendTyping(false);
    }
  };

  const submitPcMessage = () => {
    if (isProcessingImages) return;
    if (draft.trim().length === 0 && pendingImages.length === 0) return;
    const res = sendMessage(draft, pendingImages);
    if (res.ok) {
      setDraft('');
      setPendingImages([]);
      setLocalError(null);
      sendTyping(false);
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current);
      }
    } else if (res.error) {
      setLocalError(res.error);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submitPcMessage();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submitPcMessage();
    }
  };

  const activeError = localError || errorMessage;

  const mobileTyping = otherTypingUsers.some((u) => u.role === 'mobile');
  const charCount = draft.length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 clean zones */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            QR Talk
          </a>

          <div className="hidden sm:flex items-center gap-3 text-sm text-slate-600 min-w-0">
            <span className="font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap shrink-0">
              ルーム {roomId}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
              {status === 'connected' ? (
                <Wifi className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              ) : (
                <WifiOff className="w-4 h-4 text-amber-600" aria-hidden="true" />
              )}
              <span>{status === 'connected' ? 'リアルタイム接続中' : '再接続中'}</span>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap shrink-0">
              <Smartphone className="w-4 h-4 text-slate-400" aria-hidden="true" />
              <span>モバイル接続 {connections.mobile}台</span>
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={isDownloadingZip}
              className="min-h-[40px] px-4 py-2 inline-flex items-center gap-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:bg-slate-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span>{isDownloadingZip ? 'ZIP生成中…' : 'ZIP'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Desktop Workspace */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start">
        {/* Left Column: QR Code Panel */}
        <aside className="bg-white border border-slate-200 rounded-2xl p-6 lg:sticky lg:top-22">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-semibold text-slate-900 truncate">
              iPhoneでQRコードを読み取る
            </h1>
            <button
              type="button"
              onClick={onCreateNewRoom}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              新しいルーム
            </button>
          </div>
          <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
            カメラアプリで読み込むとトークルームが開き、送信した文章がこの画面に即座に表示されます。
          </p>

          <div className="mt-5 flex flex-col items-center">
            <button
              type="button"
              onClick={() => setIsQrModalOpen(true)}
              className="group relative rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 cursor-pointer"
              aria-label="QRコードを拡大表示する"
            >
              <QrCodeDisplay value={roomUrl} size={224} />
              <span className="mt-2 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500 group-hover:text-blue-600 transition-colors">
                <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>拡大表示</span>
              </span>
            </button>
          </div>

          <div className="mt-5 pt-5 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>ルームコード</span>
              <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums tracking-wider">
                {roomId}
              </span>
            </div>

            <div className="text-xs text-slate-500 break-all font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              {roomUrl}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleCopyUrl}
                className="min-h-[40px] px-3 py-2 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                {copiedUrl ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    <span>コピー済み</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                    <span>URLをコピー</span>
                  </>
                )}
              </button>

              <a
                href={roomUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[40px] px-3 py-2 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-blue-600 bg-blue-50/70 border border-blue-200 rounded-lg hover:bg-blue-100/70 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                <span>ルームを開く</span>
              </a>
            </div>
          </div>

          <ol className="mt-5 pt-5 border-t border-slate-200 space-y-2.5 text-xs text-slate-600">
            <li className="flex items-baseline gap-2.5">
              <span className="font-mono font-semibold text-slate-400 tabular-nums shrink-0">01.</span>
              <span>iPhoneのカメラでQRコードを読み取る</span>
            </li>
            <li className="flex items-baseline gap-2.5">
              <span className="font-mono font-semibold text-slate-400 tabular-nums shrink-0">02.</span>
              <span>開いたトークルームから文章（5,000文字以内）や画像を送信</span>
            </li>
            <li className="flex items-baseline gap-2.5">
              <span className="font-mono font-semibold text-slate-400 tabular-nums shrink-0">03.</span>
              <span>右側の画面へリアルタイムで内容が反映されます</span>
            </li>
          </ol>
        </aside>

        {/* Right Column: Real-Time Message Canvas */}
        <section className="flex flex-col bg-white border border-slate-200 rounded-2xl min-h-[560px] lg:min-h-[calc(100vh-8.5rem)]">
          {/* Stream Header */}
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-slate-900">受信メッセージ</h2>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="text-sm font-mono text-slate-500 tabular-nums">
                {messages.length}件
              </span>
              {mobileTyping && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="text-sm font-medium text-blue-600">
                    iPhoneが入力中…
                  </span>
                </>
              )}
            </div>

            {messages.length > 0 && (
              <div className="flex items-center gap-2">
                {confirmClear ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        clearRoom();
                        setConfirmClear(false);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      すべて消去する
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      キャンセル
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-red-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    履歴をクリア
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Messages List / Empty State */}
          <div className="flex-1 p-6 overflow-y-auto space-y-4">
            {messages.length === 0 ? (
              <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center max-w-md mx-auto">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-500 mb-4">
                  <Monitor className="w-6 h-6" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">
                  iPhoneからの送信を待機しています
                </h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  左のQRコードをiPhoneで読み取り、トークルームから文章（最大5,000文字）や画像を送信すると、ここにリアルタイムで表示されます。
                </p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((msg) => {
                  const hasText = msg.text.trim().length > 0;
                  const hasImages = Boolean(msg.images && msg.images.length > 0);
                  return (
                    <motion.article
                      key={msg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      className={`rounded-xl border p-5 ${
                        msg.role === 'mobile'
                          ? 'bg-slate-50/70 border-slate-200'
                          : 'bg-blue-50/40 border-blue-200/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-200/70">
                        <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
                          <span className="font-semibold text-slate-900 truncate">
                            {msg.senderName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <time
                            dateTime={new Date(msg.createdAt).toISOString()}
                            className="font-mono tabular-nums shrink-0"
                          >
                            {formatTime(msg.createdAt)}
                          </time>
                          {hasText && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums shrink-0">
                                {msg.text.length.toLocaleString()}文字
                              </span>
                            </>
                          )}
                          {hasImages && msg.images && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums shrink-0">
                                画像{msg.images.length}枚
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {hasText && (
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg)}
                              className="min-h-[32px] px-2.5 py-1 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                            >
                              {copiedMessageId === msg.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                                  <span>コピー済み</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                                  <span>コピー</span>
                                </>
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => deleteMessage(msg.id)}
                            className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition-colors cursor-pointer"
                            aria-label="このメッセージを削除"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      {hasImages && msg.images && (
                        <div
                          className={`mt-3 grid gap-3 ${
                            msg.images.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
                          }`}
                        >
                          {msg.images.map((img) => (
                            <div
                              key={img.id}
                              className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                            >
                              <button
                                type="button"
                                onClick={() => setPreviewImage(img)}
                                className="w-full block bg-slate-100/70 hover:opacity-95 transition-opacity cursor-zoom-in focus-visible:outline-2 focus-visible:outline-blue-600"
                                aria-label={`${img.name}を拡大表示`}
                              >
                                <img
                                  src={img.dataUrl}
                                  alt={img.name}
                                  className="w-full max-h-[420px] object-contain mx-auto block"
                                />
                              </button>
                              <div className="px-3 py-2 border-t border-slate-200/80 flex items-center justify-between gap-2 bg-white">
                                <span className="text-xs font-mono text-slate-500 truncate">
                                  {img.name}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleCopyImage(img)}
                                    className="px-2 py-1 inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                                  >
                                    {copiedImageId === img.id ? (
                                      <>
                                        <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                                        <span>コピー済</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                                        <span>画像コピー</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => downloadChatImage(img)}
                                    className="px-2 py-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                                  >
                                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span>保存</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {hasText && (
                        <div className="mt-3 text-[15px] leading-relaxed text-slate-900 whitespace-pre-wrap break-words">
                          {msg.text}
                        </div>
                      )}
                    </motion.article>
                  );
                })}
              </AnimatePresence>
            )}
            <div ref={feedEndRef} />
          </div>

          {/* Optional PC Reply Bar */}
          <form
            onSubmit={handleSubmit}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDrop}
            className={`p-4 border-t border-slate-200 rounded-b-2xl transition-colors ${
              isDraggingOver ? 'bg-blue-50/70' : 'bg-slate-50/50'
            }`}
          >
            {activeError && (
              <p className="mb-2 text-xs font-medium text-red-600" role="alert">
                {activeError}
              </p>
            )}

            {pendingImages.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2.5">
                {pendingImages.map((img) => (
                  <div key={img.id} className="relative w-16 h-16">
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="w-16 h-16 rounded-xl object-cover border border-slate-200 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPendingImages((prev) => prev.filter((item) => item.id !== img.id))
                      }
                      aria-label={`${img.name}を削除`}
                      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-xs cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <label htmlFor="pc-reply-input" className="text-xs font-medium text-slate-600">
                    PCからトークルームへ送信（画像の貼り付け・ドロップ / Ctrl+Enter対応）
                  </label>
                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums shrink-0">
                    {pendingImages.length > 0 && (
                      <>
                        <span className="text-blue-600 font-medium">
                          画像 {pendingImages.length}/{MAX_IMAGES_PER_MESSAGE}枚
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                      </>
                    )}
                    <span
                      className={
                        charCount >= MAX_MESSAGE_LENGTH
                          ? 'text-red-600 font-semibold'
                          : charCount >= 4500
                            ? 'text-amber-600 font-medium'
                            : 'text-slate-500'
                      }
                    >
                      {charCount.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
                    </span>
                  </div>
                </div>
                <textarea
                  id="pc-reply-input"
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  maxLength={MAX_MESSAGE_LENGTH}
                  rows={2}
                  placeholder={
                    isProcessingImages
                      ? '画像を読み込み中…'
                      : 'PC側からiPhoneへ文章や画像を送ることもできます…'
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 resize-y"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessingImages || pendingImages.length >= MAX_IMAGES_PER_MESSAGE}
                  className="min-h-[44px] px-3.5 py-2.5 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                >
                  <ImagePlus className="w-4 h-4" aria-hidden="true" />
                  <span>画像</span>
                </button>

                <button
                  type="submit"
                  disabled={
                    isProcessingImages ||
                    (draft.trim().length === 0 && pendingImages.length === 0)
                  }
                  className="min-h-[44px] px-5 py-2.5 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                  <span>送信</span>
                </button>
              </div>
            </div>
          </form>
        </section>
      </main>

      {/* Enlarged QR Modal */}
      <AnimatePresence>
        {isQrModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-6"
            onClick={() => setIsQrModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl border border-slate-200 p-6 max-w-sm w-full flex flex-col items-center"
            >
              <div className="w-full flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-slate-900">
                  ルーム {roomId}
                </span>
                <button
                  type="button"
                  onClick={() => setIsQrModalOpen(false)}
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                  aria-label="閉じる"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <QrCodeDisplay value={roomUrl} size={300} />
              <p className="mt-4 text-xs text-slate-500 text-center">
                iPhoneのカメラを向けてトークルームを開きます
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Image Lightbox Modal */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex flex-col p-6"
            onClick={() => setPreviewImage(null)}
          >
            <div
              className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4 pb-4 text-white shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-sm font-mono truncate">{previewImage.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleCopyImage(previewImage)}
                  className="min-h-[40px] px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-medium text-white transition-colors cursor-pointer"
                >
                  {copiedImageId === previewImage.id ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                      <span>コピー済</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" aria-hidden="true" />
                      <span>画像コピー</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => downloadChatImage(previewImage)}
                  className="min-h-[40px] px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                  <span>保存する</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors cursor-pointer"
                  aria-label="閉じる"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center min-h-0">
              <img
                src={previewImage.dataUrl}
                alt={previewImage.name}
                onClick={(e) => e.stopPropagation()}
                className="max-w-full max-h-full object-contain rounded-xl"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
