import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import JSZip from 'jszip';
import { WebSocketServer, WebSocket } from 'ws';
import 'dotenv/config';
import {
  MAX_MESSAGE_LENGTH,
  type ChatMessage,
  type ClientWsEvent,
  type DeviceRole,
  type RoomConnections,
  type ServerWsEvent,
  type TypingUser,
} from './src/types/chat.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MAX_MESSAGES_PER_ROOM = 200;
const ROOM_IDLE_TTL_MS = 24 * 60 * 60 * 1000;

interface ClientSession {
  ws: WebSocket;
  roomId: string;
  role: DeviceRole;
  clientId: string;
  senderName: string;
  isTyping: boolean;
  isAlive: boolean;
}

interface RoomState {
  id: string;
  messages: ChatMessage[];
  clients: Map<WebSocket, ClientSession>;
  lastActivityAt: number;
}

const rooms = new Map<string, RoomState>();

function normalizeRoomId(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (cleaned.length < 4 || cleaned.length > 32) {
    return null;
  }
  return cleaned;
}

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      messages: [],
      clients: new Map(),
      lastActivityAt: Date.now(),
    };
    rooms.set(roomId, room);
  }
  room.lastActivityAt = Date.now();
  return room;
}

function getRoomConnections(room: RoomState): RoomConnections {
  let pc = 0;
  let mobile = 0;
  for (const session of room.clients.values()) {
    if (session.ws.readyState === WebSocket.OPEN) {
      if (session.role === 'pc') pc += 1;
      else mobile += 1;
    }
  }
  return { pc, mobile };
}

function getTypingUsers(room: RoomState): TypingUser[] {
  const seen = new Set<string>();
  const result: TypingUser[] = [];
  for (const session of room.clients.values()) {
    if (
      session.ws.readyState === WebSocket.OPEN &&
      session.isTyping &&
      !seen.has(session.clientId)
    ) {
      seen.add(session.clientId);
      result.push({
        clientId: session.clientId,
        senderName: session.senderName,
        role: session.role,
      });
    }
  }
  return result;
}

function sendJson(ws: WebSocket, payload: ServerWsEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToRoom(room: RoomState, payload: ServerWsEvent): void {
  const serialized = JSON.stringify(payload);
  for (const session of room.clients.values()) {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(serialized);
    }
  }
}

function detachClientFromRoom(ws: WebSocket): void {
  for (const room of rooms.values()) {
    const session = room.clients.get(ws);
    if (session) {
      room.clients.delete(ws);
      room.lastActivityAt = Date.now();
      broadcastToRoom(room, {
        type: 'room:presence',
        roomId: room.id,
        connections: getRoomConnections(room),
        typingUsers: getTypingUsers(room),
      });
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/config', (_req, res) => {
    const rawUrl = process.env.APP_URL || '';
    const appUrl = rawUrl && rawUrl !== 'MY_APP_URL' ? rawUrl.replace(/\/+$/, '') : '';
    res.json({ appUrl });
  });

  app.get('/api/download-zip', async (_req, res) => {
    try {
      const zip = new JSZip();
      const ignoredDirs = new Set(['node_modules', 'dist', '.git', '.aistudio']);
      const ignoredFiles = new Set(['.env']);

      const addDirToZip = async (dirPath: string, zipFolder: JSZip) => {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (ignoredDirs.has(entry.name)) continue;
            const subFolder = zipFolder.folder(entry.name);
            if (subFolder) {
              await addDirToZip(path.join(dirPath, entry.name), subFolder);
            }
          } else if (entry.isFile()) {
            if (ignoredFiles.has(entry.name)) continue;
            const fileBuffer = await fs.readFile(path.join(dirPath, entry.name));
            zipFolder.file(entry.name, fileBuffer);
          }
        }
      };

      await addDirToZip(__dirname, zip);
      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="qr-talk-app.zip"');
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err) {
      console.error('Failed to generate ZIP:', err);
      res.status(500).json({ error: 'ZIPファイルの生成に失敗しました。' });
    }
  });

  app.get('/api/rooms/:roomId', (req, res) => {
    const roomId = normalizeRoomId(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: 'Invalid room ID' });
      return;
    }
    const room = rooms.get(roomId);
    if (!room) {
      res.json({
        roomId,
        messages: [],
        connections: { pc: 0, mobile: 0 },
      });
      return;
    }
    res.json({
      roomId: room.id,
      messages: room.messages,
      connections: getRoomConnections(room),
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    const aliveState = { isAlive: true };

    ws.on('pong', () => {
      aliveState.isAlive = true;
      for (const room of rooms.values()) {
        const session = room.clients.get(ws);
        if (session) {
          session.isAlive = true;
        }
      }
    });

    ws.on('message', (rawData) => {
      let event: ClientWsEvent;
      try {
        event = JSON.parse(rawData.toString()) as ClientWsEvent;
      } catch {
        sendJson(ws, {
          type: 'error',
          code: 'INVALID_JSON',
          message: '不正なリクエスト形式です。',
        });
        return;
      }

      if (!event || typeof event !== 'object' || !('type' in event)) {
        return;
      }

      if (event.type === 'room:join') {
        const roomId = normalizeRoomId(event.roomId);
        if (!roomId) {
          sendJson(ws, {
            type: 'error',
            code: 'INVALID_ROOM',
            message: '無効なルームIDです。',
          });
          return;
        }

        detachClientFromRoom(ws);

        const room = getOrCreateRoom(roomId);
        const role: DeviceRole = event.role === 'pc' ? 'pc' : 'mobile';
        const senderName =
          typeof event.senderName === 'string' && event.senderName.trim().length > 0
            ? event.senderName.trim().slice(0, 24)
            : role === 'pc'
              ? 'PC'
              : 'iPhone';

        const session: ClientSession = {
          ws,
          roomId,
          role,
          clientId: String(event.clientId || '').slice(0, 64) || crypto.randomUUID(),
          senderName,
          isTyping: false,
          isAlive: aliveState.isAlive,
        };

        room.clients.set(ws, session);

        sendJson(ws, {
          type: 'room:state',
          roomId: room.id,
          messages: room.messages,
          connections: getRoomConnections(room),
          typingUsers: getTypingUsers(room),
        });

        broadcastToRoom(room, {
          type: 'room:presence',
          roomId: room.id,
          connections: getRoomConnections(room),
          typingUsers: getTypingUsers(room),
        });
        return;
      }

      if (event.type === 'message:send') {
        const roomId = normalizeRoomId(event.roomId);
        if (!roomId) {
          sendJson(ws, {
            type: 'error',
            code: 'INVALID_ROOM',
            message: '無効なルームIDです。',
          });
          return;
        }

        const rawText = typeof event.text === 'string' ? event.text : '';
        if (rawText.trim().length === 0) {
          sendJson(ws, {
            type: 'error',
            code: 'EMPTY_MESSAGE',
            message: 'メッセージを入力してください。',
          });
          return;
        }

        if (rawText.length > MAX_MESSAGE_LENGTH) {
          sendJson(ws, {
            type: 'error',
            code: 'MESSAGE_TOO_LONG',
            message: `文章は${MAX_MESSAGE_LENGTH.toLocaleString()}文字以内で送信してください。`,
          });
          return;
        }

        const room = getOrCreateRoom(roomId);
        const messageId =
          typeof event.id === 'string' && event.id.trim().length > 0
            ? event.id.trim().slice(0, 64)
            : crypto.randomUUID();

        // Idempotent duplicate check
        if (room.messages.some((m) => m.id === messageId)) {
          return;
        }

        const session = room.clients.get(ws);
        if (session) {
          session.isTyping = false;
        }

        const role: DeviceRole = event.role === 'pc' ? 'pc' : 'mobile';
        const senderName =
          typeof event.senderName === 'string' && event.senderName.trim().length > 0
            ? event.senderName.trim().slice(0, 24)
            : role === 'pc'
              ? 'PC'
              : 'iPhone';

        const chatMessage: ChatMessage = {
          id: messageId,
          roomId,
          text: rawText,
          senderName,
          role,
          createdAt: Date.now(),
        };

        room.messages.push(chatMessage);
        if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
          room.messages.splice(0, room.messages.length - MAX_MESSAGES_PER_ROOM);
        }
        room.lastActivityAt = Date.now();

        broadcastToRoom(room, {
          type: 'message:created',
          message: chatMessage,
        });

        broadcastToRoom(room, {
          type: 'room:presence',
          roomId: room.id,
          connections: getRoomConnections(room),
          typingUsers: getTypingUsers(room),
        });
        return;
      }

      if (event.type === 'typing:update') {
        const roomId = normalizeRoomId(event.roomId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const session = room.clients.get(ws);
        if (!session) return;

        session.isTyping = Boolean(event.isTyping);
        if (typeof event.senderName === 'string' && event.senderName.trim().length > 0) {
          session.senderName = event.senderName.trim().slice(0, 24);
        }

        broadcastToRoom(room, {
          type: 'room:presence',
          roomId: room.id,
          connections: getRoomConnections(room),
          typingUsers: getTypingUsers(room),
        });
        return;
      }

      if (event.type === 'message:delete') {
        const roomId = normalizeRoomId(event.roomId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;

        const beforeLen = room.messages.length;
        room.messages = room.messages.filter((m) => m.id !== event.messageId);
        if (room.messages.length !== beforeLen) {
          room.lastActivityAt = Date.now();
          broadcastToRoom(room, {
            type: 'message:deleted',
            roomId: room.id,
            messageId: event.messageId,
          });
        }
        return;
      }

      if (event.type === 'room:clear') {
        const roomId = normalizeRoomId(event.roomId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;

        room.messages = [];
        room.lastActivityAt = Date.now();
        broadcastToRoom(room, {
          type: 'room:cleared',
          roomId: room.id,
        });
      }
    });

    ws.on('close', () => {
      detachClientFromRoom(ws);
    });

    ws.on('error', () => {
      detachClientFromRoom(ws);
    });
  });

  // WebSocket heartbeat & stale room cleanup
  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      let alive = true;
      for (const room of rooms.values()) {
        const session = room.clients.get(client);
        if (session) {
          if (!session.isAlive) {
            alive = false;
          } else {
            session.isAlive = false;
          }
        }
      }
      if (!alive) {
        detachClientFromRoom(client);
        client.terminate();
      } else if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    }

    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
      if (room.clients.size === 0 && now - room.lastActivityAt > ROOM_IDLE_TTL_MS) {
        rooms.delete(roomId);
      }
    }
  }, 25000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
