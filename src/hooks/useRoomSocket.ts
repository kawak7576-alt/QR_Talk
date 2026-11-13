import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_MESSAGE_LENGTH,
  type ChatMessage,
  type ClientWsEvent,
  type DeviceRole,
  type RoomConnections,
  type ServerWsEvent,
  type TypingUser,
} from '../types/chat';

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface UseRoomSocketOptions {
  roomId: string;
  role: DeviceRole;
  senderName: string;
}

function getClientId(role: DeviceRole): string {
  const storageKey = `qr_talk_client_id_${role}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(storageKey, generated);
    return generated;
  } catch {
    return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useRoomSocket({ roomId, role, senderName }: UseRoomSocketOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connections, setConnections] = useState<RoomConnections>({ pc: 0, mobile: 0 });
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(getClientId(role));
  const pendingQueueRef = useRef<ClientWsEvent[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef<number>(0);
  const senderNameRef = useRef<string>(senderName);

  senderNameRef.current = senderName;

  const sendEvent = useCallback((event: ClientWsEvent) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
      return true;
    }
    if (event.type === 'message:send') {
      pendingQueueRef.current.push(event);
    }
    return false;
  }, []);

  useEffect(() => {
    let isCancelled = false;
    setMessages([]);
    setTypingUsers([]);
    setErrorMessage(null);
    retryCountRef.current = 0;

    const connect = () => {
      if (isCancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      setStatus(retryCountRef.current === 0 ? 'connecting' : 'reconnecting');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isCancelled) {
          ws.close();
          return;
        }
        retryCountRef.current = 0;
        setStatus('connected');
        setErrorMessage(null);

        const joinEvent: ClientWsEvent = {
          type: 'room:join',
          roomId,
          role,
          clientId: clientIdRef.current,
          senderName: senderNameRef.current,
        };
        ws.send(JSON.stringify(joinEvent));

        // Flush any queued outgoing messages
        if (pendingQueueRef.current.length > 0) {
          const queued = [...pendingQueueRef.current];
          pendingQueueRef.current = [];
          for (const item of queued) {
            if (item.roomId === roomId) {
              ws.send(JSON.stringify(item));
            }
          }
        }
      };

      ws.onmessage = (evt) => {
        if (isCancelled) return;
        let payload: ServerWsEvent;
        try {
          payload = JSON.parse(evt.data) as ServerWsEvent;
        } catch {
          return;
        }

        switch (payload.type) {
          case 'room:state': {
            if (payload.roomId !== roomId) return;
            setMessages(payload.messages);
            setConnections(payload.connections);
            setTypingUsers(payload.typingUsers);
            break;
          }
          case 'room:presence': {
            if (payload.roomId !== roomId) return;
            setConnections(payload.connections);
            setTypingUsers(payload.typingUsers);
            break;
          }
          case 'message:created': {
            if (payload.message.roomId !== roomId) return;
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.message.id)) {
                return prev;
              }
              return [...prev, payload.message];
            });
            break;
          }
          case 'message:deleted': {
            if (payload.roomId !== roomId) return;
            setMessages((prev) => prev.filter((m) => m.id !== payload.messageId));
            break;
          }
          case 'room:cleared': {
            if (payload.roomId !== roomId) return;
            setMessages([]);
            break;
          }
          case 'error': {
            setErrorMessage(payload.message);
            break;
          }
        }
      };

      ws.onclose = () => {
        if (isCancelled) return;
        wsRef.current = null;
        setStatus('reconnecting');
        const delays = [500, 1000, 2000, 3500, 5000];
        const delay = delays[Math.min(retryCountRef.current, delays.length - 1)];
        retryCountRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose handles reconnect
      };
    };

    connect();

    return () => {
      isCancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [roomId, role]);

  const sendMessage = useCallback(
    (text: string): { ok: boolean; error?: string } => {
      if (text.trim().length === 0) {
        return { ok: false, error: '文章を入力してください。' };
      }
      if (text.length > MAX_MESSAGE_LENGTH) {
        return {
          ok: false,
          error: `${MAX_MESSAGE_LENGTH.toLocaleString()}文字以内で入力してください。`,
        };
      }

      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      setErrorMessage(null);
      sendEvent({
        type: 'message:send',
        id,
        roomId,
        text,
        senderName: senderNameRef.current,
        role,
      });

      return { ok: true };
    },
    [roomId, role, sendEvent]
  );

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      sendEvent({
        type: 'typing:update',
        roomId,
        clientId: clientIdRef.current,
        senderName: senderNameRef.current,
        role,
        isTyping,
      });
    },
    [roomId, role, sendEvent]
  );

  const deleteMessage = useCallback(
    (messageId: string) => {
      sendEvent({
        type: 'message:delete',
        roomId,
        messageId,
      });
    },
    [roomId, sendEvent]
  );

  const clearRoom = useCallback(() => {
    sendEvent({
      type: 'room:clear',
      roomId,
    });
  }, [roomId, sendEvent]);

  const otherTypingUsers = typingUsers.filter((u) => u.clientId !== clientIdRef.current);

  return {
    messages,
    connections,
    otherTypingUsers,
    status,
    errorMessage,
    clearError: () => setErrorMessage(null),
    sendMessage,
    sendTyping,
    deleteMessage,
    clearRoom,
  };
}
