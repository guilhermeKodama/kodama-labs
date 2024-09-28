import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: ['https://app.wallex.com.br', 'http://localhost:8081'],
  },
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  private readonly logger = new Logger(EventsGateway.name);

  // Store active connections by userId -> socketId
  private activeConnections: Record<string, string> = {};

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      this.activeConnections[userId] = client.id;

      // Add the socket to a room with the userId as the room name
      client.join(userId);

      this.logger.log(`User connected: ${userId} (socket id: ${client.id})`);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = Object.keys(this.activeConnections).find(
      (key) => this.activeConnections[key] === client.id,
    );
    if (userId) {
      delete this.activeConnections[userId];
      this.logger.log(`User disconnected: ${userId} (socket id: ${client.id})`);
    }
  }

  // Notify the user of pending process change
  notifyUserHasPendingProcessChanged(
    userId: string,
    hasPendingProcess: boolean,
  ): void {
    this.logger.debug(
      `trigger: hasProcessingPendingChanged for user ${userId}`,
    );
    this.server
      .to(userId)
      .emit('hasProcessingPendingChanged', { hasPendingProcess });
  }
}
