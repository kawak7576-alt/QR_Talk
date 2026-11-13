import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, Edit3, Send, Wifi, WifiOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { MAX_MESSAGE_LENGTH, type ChatMessage } from '../types/chat';
import { useRoomSocket } from '../hooks/useRoomSocket';

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

  const handleSend = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim().length === 0) {
      setLocalError('送信する文章を入力してください。');
      return;
    }

    const res = sendMessage(draft);
    if (res.ok) {
      setDraft('');
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
              下の入力欄から最大5,000文字の文章を送信すると、PC画面にリアルタイムで反映されます。
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg) => {
              const isOwnSide = msg.role === 'mobile';
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                  className={`flex flex-col ${isOwnSide ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
                      isOwnSide
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-white border border-slate-200 text-slate-900 rounded-bl-md'
                    }`}
                  >
                    {msg.text}
                  </div>
                  <div className="mt-1 px-1 flex items-center gap-2 text-[11px] text-slate-500">
                    <span>{msg.senderName}</span>
                    <span aria-hidden="true">·</span>
                    <time className="font-mono tabular-nums">
                      {formatShortTime(msg.createdAt)}
                    </time>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {msg.text.length.toLocaleString()}文字
                    </span>
                    {!isOwnSide && (
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
          <span
            className={`text-xs font-mono tabular-nums ${
              charCount >= MAX_MESSAGE_LENGTH
                ? 'text-red-600 font-semibold'
                : charCount >= 4500
                  ? 'text-amber-600 font-medium'
                  : 'text-slate-500'
            }`}
          >
            {charCount.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()} 文字
          </span>

          {draft.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setDraft('');
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

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={2}
            placeholder="PC画面に送る文章を入力（5,000文字以内）"
            aria-label="送信する文章（5,000文字以内）"
            className="flex-1 min-h-[48px] max-h-[144px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[16px] leading-snug text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 resize-none"
          />

          <button
            type="submit"
            disabled={draft.trim().length === 0}
            className="min-h-[48px] min-w-[76px] px-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 text-white text-sm font-semibold active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-400 transition-all shrink-0"
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
    </div>
  );
}
