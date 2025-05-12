import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  JSONRPCMessage,
  // JSONRPCRequest, // Removed unused import
  // JSONRPCResponse, // Removed unused import
} from "@modelcontextprotocol/sdk/types.js";
import { v4 as uuidv4 } from "uuid";
import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";

export class WebSocketServerTransport implements Transport {
  private wss!: WebSocketServer;
  private clients: Map<string, WebSocket> = new Map();

  onclose?: () => void;
  onerror?: (err: Error) => void;
  private messageHandler?: (msg: JSONRPCMessage, clientId: string) => void; // clientId is for internal use by this class
  onconnection?: (clientId: string) => void;
  ondisconnection?: (clientId: string) => void;

  path: string;

  // The Server from MCP SDK will set this onmessage.
  // This setter wraps the original handler to inject clientId logic if needed,
  // or to handle message specific transformations before passing to the SDK's handler.
  set onmessage(handler: ((message: JSONRPCMessage) => void) | undefined) {
    this.messageHandler = handler
      ? (msg: JSONRPCMessage, clientId: string) => {
          if ("id" in msg && msg.id !== undefined && msg.id !== null) {
            const originalId = msg.id;
            // Create a new object for the modified message to avoid altering the original `msg` object
            // that might be used elsewhere, and to ensure type safety.
            const newMsg = { ...msg, id: `${clientId}:${originalId}` };
            handler(newMsg as JSONRPCMessage); // Pass the modified message
          } else {
            // For notifications or messages without IDs, pass as is.
            handler(msg);
          }
        }
      : undefined;
  }

  constructor({ path, server }: { path: string; server: Server }) {
    this.path = path;
    this.wss = new WebSocketServer({
      path,
      server,
    });
  }

  async start(): Promise<void> {
    this.wss.on("connection", (ws: WebSocket) => {
      const clientId = uuidv4();
      this.clients.set(clientId, ws);
      this.onconnection?.(clientId); // Notify that a client has connected

      ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as JSONRPCMessage;
          this.messageHandler?.(msg, clientId);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.onerror?.(
            new Error(`Failed to parse message: ${error.message}`)
          );
        }
      });

      ws.on("close", () => {
        this.clients.delete(clientId);
        this.ondisconnection?.(clientId); // Notify that a client has disconnected
      });

      ws.on("error", (err: Error) => {
        this.onerror?.(err); // Notify about an error
      });
    });
  }

  // This send method might be called by the MCP SDK's Server instance
  // The clientId parameter here could be the composite ID like 'clientId:msgId'
  // or just 'clientId'. The current transport's onmessage setter creates 'clientId:originalId'.
  // The MCP Server.send (or similar) will likely call this.
  async send(msg: JSONRPCMessage, targetId?: string): Promise<void> {
    let clientToUse: WebSocket | undefined;
    let actualClientId: string | undefined = targetId;
    let messageToSend = { ...msg }; // Clone message to safely modify its ID property

    if (targetId && targetId.includes(":")) {
      const parts = targetId.split(":", 2); // Split into 2 parts: clientId and originalMsgId
      actualClientId = parts[0];
      const originalMsgId = parts[1];
      // Restore the original message ID. Ensure it's number or string.
      // The JSONRPC spec allows string or number for id.
      // If originalMsgId can be parsed as a number, use number, else string.
      // @ts-ignore
      messageToSend.id = isNaN(Number(originalMsgId))
        ? originalMsgId
        : Number(originalMsgId);
    }

    const data = JSON.stringify(messageToSend);

    if (actualClientId) {
      clientToUse = this.clients.get(actualClientId);
    }

    if (clientToUse) {
      if (clientToUse.readyState === WebSocket.OPEN) {
        clientToUse.send(data);
      } else {
        this.clients.delete(actualClientId!);
        this.ondisconnection?.(actualClientId!);
        console.warn(`Attempted to send to a closed client: ${actualClientId}`);
      }
    } else if (!targetId && !("id" in msg)) {
      // Broadcast notifications (messages without ID and no specific targetId)
      console.log("Broadcasting notification:", messageToSend);
      this.clients.forEach((client, id) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        } else {
          this.clients.delete(id);
          this.ondisconnection?.(id);
        }
      });
    } else if (targetId) {
      console.warn(
        `WebSocket client with ID ${actualClientId} not found for sending message.`
      );
    } else {
      // This case (has ID but no targetId) might be an error or unhandled scenario for directed messages
      console.warn(
        "Send called with message ID but no target client ID:",
        messageToSend
      );
    }
  }

  async broadcast(msg: JSONRPCMessage): Promise<void> {
    // This broadcast method ignores any client/message ID mangling
    // and sends the raw message to all clients.
    const data = JSON.stringify(msg);
    this.clients.forEach((client, id) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      } else {
        // Clean up dead clients
        this.clients.delete(id);
        this.ondisconnection?.(id);
      }
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.clients.clear();
        this.onclose?.(); // Call the onclose callback
        resolve();
      });
    });
  }
}
