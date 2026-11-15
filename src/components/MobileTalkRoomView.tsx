import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent } from 'react';
import { Check, Copy, Download, Edit3, ImagePlus, Send, Wifi, WifiOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { MAX_IMAGES_PER_MESSAGE, MAX_MESSAGE_LENGTH, type ChatImage, type ChatMessage } from '../types/chat';
import { useRoomSocket } from '../hooks/useRoomSocket';
import { downloadChatImage, processImageFile } from '../utils/imageProcessor';

interface MobileTalkRoomViewProps {
  roomId: string;
}

const SENDER_NAME_STORAGE_KEY = 'qr_talk_mobile_sender_name';

function loadSavedSenderName(): string {
  try {
    const saved = localStorage.getItem(SENDER_NAME_STORAGE_KEY);
    if (saved && saved.trim().length > 0) {
      return saved.trim().slice(0, 24);
    }
  } catch {
    // ignore storage errors
  }
  return 'iPhone';
}

function formatShortTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MobileTalkRoomView({ roomId }: MobileTalkRoomViewProps) {
  const [senderName, setSenderName] = useState<string>(loadSavedSenderName);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(senderName);

  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [previewImage, setPreviewImage] = useState<ChatImage | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const {
    messages,
    connections,
    otherTypingUsers,
    status,
    errorMessage,
    clearError,
    sendMessage,
    sendTyping,
  } = useRoomSocket({
    roomId,
    role: 'mobile',
    senderName,
  });

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  // Auto-resize textarea smoothly up to 144px
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, 48), 144);
    el.style.height = `${nextHeight}px`;
  }, [draft]);

  const handleDraftChange = (raw: string) => {
    clearError();
    if (raw.length > MAX_MESSAGE_LENGTH) {
      setDraft(raw.slice(0, MAX_MESSAGE_LENGTH));
      setLocalError(
        `${MAX_MESSAGE_LENGTH.toLocaleString()}文字を超えたため、先頭${MAX_MESSAGE_LENGTH.toLocaleString()}文字まで入力されました。`
      );
    } else {
      setDraft(raw);
      setLocalError(null);
    }

    if (raw.trim().length > 0) {
      sendTyping(true);
      if (typingTimerRef.current !== null) {
        window.clearTimeout(typingTimerRef.current);
      }
      typingTimerRef.current = window.setTimeout(() => {
        sendTyping(false);
      }, 1500);
    } else {
      sendTyping(false);
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
      setLocalError(`画像は一度に${MAX_IMAGES_PER_MESSAGE}枚まで添付できます（先頭${remainingSlots}枚を追加しました）。`);
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

  const handleSend = (e: FormEvent) => {
    e.preventDefault();
    if (isProcessingImages) return;
    if (draft.trim().length === 0 && pendingImages.length === 0) {
      setLocalError('送信する文章または画像を入力してください。');
      return;
    }

    const res = sendMessage(draft, pendingImages);
    if (res.ok) {
      setDraft('');
      setPendingImages([]);
      setLocalError(null);
      sendTyping(false);
      if (typingTimerRef.current !== null) {
        window.clearTimeout(typingTimerRef.current);
      }
      textareaRef.current?.focus();
    } else if (res.error) {
      setLocalError(res.error);
    }
  };

  const handleSaveName = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = nameInput.trim().slice(0, 24) || 'iPhone';
    setSenderName(cleaned);
    setNameInput(cleaned);
    try {
      localStorage.setItem(SENDER_NAME_STORAGE_KEY, cleaned);
    } catch {
      // ignore
    }
    setIsEditingName(false);
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopiedId(msg.id);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === msg.id ? null : prev));
      }, 1800);
    } catch {
      // ignore
    }
  };

  const charCount = draft.length;
  const activeError = localError || errorMessage;
  const pcTyping = otherTypingUsers.some((u) => u.role === 'pc');

  return (
    <div className="h-[100dvh] flex flex-col bg-slate-50 text-slate-900 overflow-hidden">
      {/* Compact Sticky Mobile Header (<15% viewport height) */}
      <header className="h-14 shrink-0 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 flex items-center justify-between gap-3 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            QR Talk
          </span>
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="text-xs font-mono font-medium text-slate-600 tabular-nums truncate">
            {roomId}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 whitespace-nowrap">
            {status === 'connected' ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
            )}
            <span>{status === 'connected' ? `PC ${connections.pc}台` : '再接続中'}</span>
          </span>

          <button
            type="button"
            onClick={() => {
              setNameInput(senderName);
              setIsEditingName(true);
            }}
            className="min-h-[36px] px-2.5 py-1 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 active:bg-slate-100 whitespace-nowrap"
            aria-label="送信者名を変更"
          >
            <Edit3 className="w-3 h-3 text-slate-500" aria-hidden="true" />
            <span className="max-w-[72px] truncate">{senderName}</span>
          </button>
        </div>
      </header>

      {/* Scrollable Message Stream */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <p className="text-sm font-semibold text-slate-900">
              トークルームへようこそ
            </p>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed max-w-xs">
              下の入力欄から最大5,000文字の文章や画像を送信すると、PC画面にリアルタイムで反映されます。
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg) => {
              const isOwnSide = msg.role === 'mobile';
              const hasImages = Boolean(msg.images && msg.images.length > 0);
              const hasText = msg.text.trim().length > 0;
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                  className={`flex flex-col ${isOwnSide ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl overflow-hidden ${
                      isOwnSide
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-white border border-slate-200 text-slate-900 rounded-bl-md'
                    }`}
                  >
                    {hasImages && msg.images && (
                      <div
                        className={`grid gap-1 p-1.5 ${
                          msg.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                        }`}
                      >
                        {msg.images.map((img) => (
                          <button
                            key={img.id}
                            type="button"
                            onClick={() => setPreviewImage(img)}
                            className="block overflow-hidden rounded-xl bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600"
                          >
                            <img
                              src={img.dataUrl}
                              alt={img.name}
                              className="w-full max-h-64 object-cover block"
                            />
                          </button>
                        ))}
                      </div>
                    )}

                    {hasText && (
                      <div
                        className={`px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
                          hasImages ? 'pt-1.5' : ''
                        }`}
                      >
                        {msg.text}
                      </div>
                    )}
                  </div>
                  <div className="mt-1 px-1 flex items-center gap-2 text-[11px] text-slate-500">
                    <span>{msg.senderName}</span>
                    <span aria-hidden="true">·</span>
                    <time className="font-mono tabular-nums">
                      {formatShortTime(msg.createdAt)}
                    </time>
                    {hasText && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {msg.text.length.toLocaleString()}文字
                        </span>
                      </>
                    )}
                    {hasImages && msg.images && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          画像{msg.images.length}枚
                        </span>
                      </>
                    )}
                    {!isOwnSide && hasText && (
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(msg)}
                        className="ml-1 inline-flex items-center gap-1 text-blue-600 font-medium"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="w-3 h-3" aria-hidden="true" />
                            <span>コピー済</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" aria-hidden="true" />
                            <span>コピー</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}

        {pcTyping && (
          <div className="text-xs text-slate-500 px-1">PC側が入力中…</div>
        )}
        <div ref={feedEndRef} />
      </main>

      {/* Thumb-Zone Composer Docked at Bottom */}
      <form
        onSubmit={handleSend}
        className="shrink-0 bg-white border-t border-slate-200 px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {activeError && (
          <div className="mb-2 text-xs font-medium text-red-600 px-1" role="alert">
            {activeError}
          </div>
        )}

        <div className="flex items-center justify-between px-1 mb-1.5">
          <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
            <span
              className={
                charCount >= MAX_MESSAGE_LENGTH
                  ? 'text-red-600 font-semibold'
                  : charCount >= 4500
                    ? 'text-amber-600 font-medium'
                    : 'text-slate-500'
              }
            >
              {charCount.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()} 文字
            </span>
            {pendingImages.length > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="text-blue-600 font-medium">
                  画像 {pendingImages.length}/{MAX_IMAGES_PER_MESSAGE}枚
                </span>
              </>
            )}
          </div>

          {(draft.length > 0 || pendingImages.length > 0) && (
            <button
              type="button"
              onClick={() => {
                setDraft('');
                setPendingImages([]);
                setLocalError(null);
                sendTyping(false);
                textareaRef.current?.focus();
              }}
              className="text-xs font-medium text-slate-500 active:text-slate-800 px-2 py-0.5"
            >
              クリア
            </button>
          )}
        </div>

        {/* Pending Image Previews */}
        {pendingImages.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-2 px-0.5">
            {pendingImages.map((img) => (
              <div key={img.id} className="relative shrink-0 w-16 h-16">
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-16 h-16 rounded-xl object-cover border border-slate-200"
                />
                <button
                  type="button"
                  onClick={() =>
                    setPendingImages((prev) => prev.filter((item) => item.id !== img.id))
                  }
                  aria-label={`${img.name}を削除`}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-xs"
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

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessingImages || pendingImages.length >= MAX_IMAGES_PER_MESSAGE}
            aria-label="画像を添付する"
            className="min-h-[48px] min-w-[48px] inline-flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 active:bg-slate-100 disabled:opacity-40 transition-colors shrink-0"
          >
            <ImagePlus className="w-5 h-5" aria-hidden="true" />
          </button>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onPaste={handlePaste}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={2}
            placeholder={
              isProcessingImages
                ? '画像を読み込み中…'
                : '文章（5,000文字以内）や画像を送る'
            }
            aria-label="送信する文章（5,000文字以内）"
            className="flex-1 min-h-[48px] max-h-[144px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[16px] leading-snug text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 resize-none"
          />

          <button
            type="submit"
            disabled={
              isProcessingImages ||
              (draft.trim().length === 0 && pendingImages.length === 0)
            }
            className="min-h-[48px] min-w-[72px] px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 text-white text-sm font-semibold active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-400 transition-all shrink-0"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            <span>送信</span>
          </button>
        </div>
      </form>

      {/* Sender Name Edit Bottom Sheet / Dialog */}
      <AnimatePresence>
        {isEditingName && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center"
            onClick={() => setIsEditingName(false)}
          >
            <motion.form
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              onSubmit={handleSaveName}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">送信者名の変更</h2>
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-500"
                  aria-label="閉じる"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value.slice(0, 24))}
                maxLength={24}
                autoFocus
                placeholder="例: iPhone"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-[16px] text-slate-900 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
              <button
                type="submit"
                className="w-full min-h-[48px] rounded-xl bg-blue-600 text-white text-sm font-semibold active:scale-[0.98] transition-transform"
              >
                保存する
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Fullscreen Image Preview Lightbox */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/90 flex flex-col"
            onClick={() => setPreviewImage(null)}
          >
            <div
              className="h-14 px-4 flex items-center justify-between text-white shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-xs font-mono truncate max-w-[60%]">
                {previewImage.name}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadChatImage(previewImage)}
                  className="min-h-[40px] px-3 inline-flex items-center gap-1.5 rounded-lg bg-white/15 text-xs font-medium text-white"
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                  <span>保存</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg bg-white/15 text-white"
                  aria-label="閉じる"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
              <img
                src={previewImage.dataUrl}
                alt={previewImage.name}
                className="max-w-full max-h-full object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
