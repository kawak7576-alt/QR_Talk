export const MAX_MESSAGE_LENGTH = 5000;

export type DeviceRole = 'pc' | 'mobile';

export interface ChatMessage {
  id: string;
  roomId: string;
  text: string;
  senderName: string;
  role: DeviceRole;
  createdAt: number;
}

export interface RoomConnections {
  pc: number;
  mobile: number;
}

export interface TypingUser {
  clientId: string;
  senderName: string;
  role: DeviceRole;
}

export type ClientWsEvent =
  | {
      type: 'room:join';
      roomId: string;
      role: DeviceRole;
      clientId: string;
      senderName: string;
    }
  | {
      type: 'message:send';
      id: string;
      roomId: string;
      text: string;
      senderName: string;
      role: DeviceRole;
    }
  | {
      type: 'typing:update';
      roomId: string;
      clientId: string;
      senderName: string;
      role: DeviceRole;
      isTyping: boolean;
    }
  | {
      type: 'message:delete';
      roomId: string;
      messageId: string;
    }
  | {
      type: 'room:clear';
      roomId: string;
    };

export type ServerWsEvent =
  | {
      type: 'room:state';
      roomId: string;
      messages: ChatMessage[];
      connections: RoomConnections;
      typingUsers: TypingUser[];
    }
  | {
      type: 'room:presence';
      roomId: string;
      connections: RoomConnections;
      typingUsers: TypingUser[];
    }
  | {
      type: 'message:created';
      message: ChatMessage;
    }
  | {
      type: 'message:deleted';
      roomId: string;
      messageId: string;
    }
  | {
      type: 'room:cleared';
      roomId: string;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };
