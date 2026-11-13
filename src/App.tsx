import { useCallback, useEffect, useState } from 'react';
import { MobileTalkRoomView } from './components/MobileTalkRoomView';
import { PcRoomView } from './components/PcRoomView';

const PC_ROOM_STORAGE_KEY = 'qr_talk_pc_room_id';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomId(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ROOM_ALPHABET.charAt(Math.floor(Math.random() * ROOM_ALPHABET.length));
  }
  return code;
}

function normalizeRoomId(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (cleaned.length < 4 || cleaned.length > 32) {
    return null;
  }
  return cleaned;
}

function parseRoute(): { mode: 'pc' | 'mobile'; roomId: string | null } {
  const pathname = window.location.pathname;
  const match = pathname.match(/^\/room\/([A-Za-z0-9_-]+)\/?$/);
  if (match && match[1]) {
    const normalized = normalizeRoomId(match[1]);
    if (normalized) {
      return { mode: 'mobile', roomId: normalized };
    }
  }

  const params = new URLSearchParams(window.location.search);
  const queryRoom = params.get('room');
  if (queryRoom) {
    const normalized = normalizeRoomId(queryRoom);
    if (normalized) {
      return {
        mode: params.get('view') === 'mobile' ? 'mobile' : 'pc',
        roomId: normalized,
      };
    }
  }

  return { mode: 'pc', roomId: null };
}

function getOrCreatePcRoomId(routeRoomId: string | null): string {
  if (routeRoomId) return routeRoomId;
  try {
    const stored = localStorage.getItem(PC_ROOM_STORAGE_KEY);
    if (stored) {
      const normalized = normalizeRoomId(stored);
      if (normalized) return normalized;
    }
  } catch {
    // ignore storage access issues
  }
  const fresh = generateRoomId();
  try {
    localStorage.setItem(PC_ROOM_STORAGE_KEY, fresh);
  } catch {
    // ignore
  }
  return fresh;
}

export default function App() {
  const [route] = useState(parseRoute);
  const [pcRoomId, setPcRoomId] = useState<string>(() => getOrCreatePcRoomId(route.roomId));
  const [baseUrl, setBaseUrl] = useState<string>(() => window.location.origin);

  useEffect(() => {
    if (route.mode !== 'pc') return;

    const isLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocalhost) {
      fetch('/api/config')
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { appUrl?: string } | null) => {
          if (data?.appUrl) {
            setBaseUrl(data.appUrl);
          }
        })
        .catch(() => {
          // keep window.location.origin
        });
    }
  }, [route.mode]);

  const handleCreateNewRoom = useCallback(() => {
    const nextId = generateRoomId();
    setPcRoomId(nextId);
    try {
      localStorage.setItem(PC_ROOM_STORAGE_KEY, nextId);
    } catch {
      // ignore
    }
    if (window.location.search) {
      window.history.replaceState(null, '', '/');
    }
  }, []);

  if (route.mode === 'mobile' && route.roomId) {
    return <MobileTalkRoomView roomId={route.roomId} />;
  }

  const roomUrl = `${baseUrl}/room/${pcRoomId}`;

  return (
    <PcRoomView
      roomId={pcRoomId}
      roomUrl={roomUrl}
      onCreateNewRoom={handleCreateNewRoom}
    />
  );
}
