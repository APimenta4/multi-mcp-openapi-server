import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import {
  JSONRPCMessage,
  isInitializeRequest,
  isJSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js"
import * as http from "http"
import { randomUUID } from "crypto"

/**
 * Session data for a connected client
 */
interface SessionData {
  messageHandler: (message: JSONRPCMessage) => void
  activeResponses: Set<http.ServerResponse>
  initialized: boolean
}

/**
 * StreamableHttpServerTransport implements the MCP Streamable HTTP transport.
 * It supports chunked HTTP responses (not using SSE) for streaming.
 *
 * This transport follows the MCP spec, including:
 * - Session management using Mcp-Session-Id header
 * - POST for client requests
 * - GET for streaming responses
 * - DELETE for session termination
 */
export class StreamableHttpServerTransport implements Transport {
  private server: http.Server
  private sessions: Map<string, SessionData> = new Map()
  private started = false
  private maxBodySize = 4 * 1024 * 1024 // 4MB max request size

  /**
   * Initialize a new StreamableHttpServerTransport
   *
   * @param port HTTP port to listen on
   * @param host Host to bind to (default: 127.0.0.1)
   * @param endpointPath Endpoint path (default: /mcp)
   */
  constructor(
    private port: number,
    private host: string = "127.0.0.1",
    private endpointPath: string = "/mcp",
  ) {
    this.server = http.createServer(this.handleRequest.bind(this))
  }

  /**
   * Callback when message is received
   */
  onmessage?: (message: JSONRPCMessage) => void

  /**
   * Callback when error occurs
   */
  onerror?: (error: Error) => void

  /**
   * Callback when transport closes
   */
  onclose?: () => void

  /**
   * Start the transport
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error("Transport already started")
    }

    return new Promise<void>((resolve, reject) => {
      this.server.listen(this.port, this.host, () => {
        this.started = true
        console.error(
          `Streamable HTTP transport listening on http://${this.host}:${this.port}${this.endpointPath}`,
        )
        resolve()
      })

      this.server.on("error", (err) => {
        reject(err)
        if (this.onerror) {
          this.onerror(err)
        }
      })
    })
  }

  /**
   * Close the transport
   */
  async close(): Promise<void> {
    // Close all active sessions
    for (const session of this.sessions.values()) {
      for (const response of session.activeResponses) {
        try {
          response.end()
        } catch (err: any) {
          // Ignore errors from already closed connections
        }
      }
    }

    this.sessions.clear()

    // Close the server
    return new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        } else {
          this.started = false
          if (this.onclose) {
            this.onclose()
          }
          resolve()
        }
      })
    })
  }

  /**
   * Send message to client(s)
   *
   * @param message JSON-RPC message
   */
  async send(message: JSONRPCMessage): Promise<void> {
    // For now, broadcast to all sessions - in a production implementation
    // you'd want to track which session each message belongs to
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.activeResponses.size > 0) {
        const messageStr = JSON.stringify(message) + "\n"

        // Send to all active streaming connections for this session
        for (const response of session.activeResponses) {
          try {
            response.write(messageStr)
          } catch (err: any) {
            // Remove dead connections
            session.activeResponses.delete(response)
            if (this.onerror) {
              this.onerror(new Error(`Failed to write to response: ${err.message}`))
            }
          }
        }
      }
    }
  }

  /**
   * Handle HTTP request
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Only handle requests to the MCP endpoint
    if (req.url !== this.endpointPath) {
      res.writeHead(404)
      res.end()
      return
    }

    // Validate origin header to prevent DNS rebinding attacks
    this.validateOrigin(req, res)

    switch (req.method) {
      case "POST":
        this.handlePostRequest(req, res)
        break
      case "GET":
        this.handleGetRequest(req, res)
        break
      case "DELETE":
        this.handleDeleteRequest(req, res)
        break
      default:
        // Method not allowed
        res.writeHead(405, { Allow: "POST, GET, DELETE" })
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Method not allowed",
            },
            id: null,
          }),
        )
    }
  }

  /**
   * Validate origin header to prevent DNS rebinding attacks
   */
  private validateOrigin(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const origin = req.headers.origin

    // Allow requests without origin (e.g., curl, non-browser clients)
    if (!origin) {
      return true
    }

    // In a production implementation, you would validate the origin against a whitelist
    // This is a simplified check that assumes local development
    try {
      const originUrl = new URL(origin)
      const isLocalhost = originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1"

      if (!isLocalhost) {
        res.writeHead(403)
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Origin not allowed",
            },
            id: null,
          }),
        )
        return false
      }

      return true
    } catch (err) {
      res.writeHead(400)
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Invalid origin",
          },
          id: null,
        }),
      )
      return false
    }
  }

  /**
   * Handle POST request
   */
  private handlePostRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Check content type
    const contentType = req.headers["content-type"]
    if (!contentType || !contentType.includes("application/json")) {
      res.writeHead(415)
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Unsupported Media Type: Content-Type must be application/json",
          },
          id: null,
        }),
      )
      return
    }

    // Read request body
    let body = ""
    let size = 0

    req.on("data", (chunk) => {
      size += chunk.length
      if (size > this.maxBodySize) {
        res.writeHead(413)
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Request entity too large",
            },
            id: null,
          }),
        )
        req.destroy()
        return
      }
      body += chunk.toString()
    })

    req.on("end", () => {
      try {
        // Parse JSON-RPC message
        const message = JSON.parse(body) as JSONRPCMessage

        // Handle initialization request
        if (isInitializeRequest(message)) {
          this.handleInitializeRequest(message, req, res)
        } else {
          // Handle regular request - check session
          const sessionId = req.headers["mcp-session-id"] as string

          if (!sessionId || !this.sessions.has(sessionId)) {
            res.writeHead(400)
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "Invalid session. A valid Mcp-Session-Id header is required.",
                },
                id: "id" in message ? message.id : null,
              }),
            )
            return
          }

          const session = this.sessions.get(sessionId)!

          // For requests, wait for response through the message handler
          if (isJSONRPCRequest(message)) {
            if (session.messageHandler) {
              session.messageHandler(message)

              // For requests from client, respond with immediate 202 Accepted
              // The actual response will be sent via the streaming GET connection
              res.writeHead(202)
              res.end()
            }
          } else {
            // For notifications (no id), just process and acknowledge
            if (session.messageHandler) {
              session.messageHandler(message)
              res.writeHead(202)
              res.end()
            }
          }
        }
      } catch (err) {
        res.writeHead(400)
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32700,
              message: "Parse error",
              data: String(err),
            },
            id: null,
          }),
        )

        if (this.onerror) {
          this.onerror(new Error(`Parse error: ${String(err)}`))
        }
      }
    })

    req.on("error", (err) => {
      if (this.onerror) {
        this.onerror(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /**
   * Handle initialization request
   */
  private handleInitializeRequest(
    message: JSONRPCMessage,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    // Generate new session
    const sessionId = randomUUID()

    // Create session
    this.sessions.set(sessionId, {
      messageHandler: this.onmessage || (() => {}),
      activeResponses: new Set(),
      initialized: true,
    })

    // Pass to message handler
    if (this.onmessage) {
      this.onmessage(message)

      // Unlike regular requests, for initialization we need to wait for the Protocol to generate
      // a response and call send() before closing the HTTP response, so we leave the response open

      // Add this response to the session's active responses for a moment
      const session = this.sessions.get(sessionId)!

      // Set headers for initialization response
      res.setHeader("Content-Type", "application/json")
      res.setHeader("Mcp-Session-Id", sessionId)
    }
  }

  /**
   * Handle GET request (streaming connection)
   */
  private handleGetRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // All GET requests must have a session ID
    const sessionId = req.headers["mcp-session-id"] as string

    if (!sessionId || !this.sessions.has(sessionId)) {
      res.writeHead(400)
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Invalid session. A valid Mcp-Session-Id header is required.",
          },
          id: null,
        }),
      )
      return
    }

    const session = this.sessions.get(sessionId)!

    // Set headers for streaming response
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("Cache-Control", "no-cache, no-transform")
    res.setHeader("Transfer-Encoding", "chunked")
    res.setHeader("Mcp-Session-Id", sessionId)

    // Send 200 OK status
    res.writeHead(200)

    // Store the response for future messages
    session.activeResponses.add(res)

    // Handle client disconnect
    req.on("close", () => {
      session.activeResponses.delete(res)
    })

    // Ensure resource cleanup
    res.on("error", (err) => {
      session.activeResponses.delete(res)
      if (this.onerror) {
        this.onerror(err)
      }
    })
  }

  /**
   * Handle DELETE request (session termination)
   */
  private handleDeleteRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const sessionId = req.headers["mcp-session-id"] as string

    if (!sessionId || !this.sessions.has(sessionId)) {
      res.writeHead(400)
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Invalid session. A valid Mcp-Session-Id header is required.",
          },
          id: null,
        }),
      )
      return
    }

    const session = this.sessions.get(sessionId)!

    // Close all active connections
    for (const response of session.activeResponses) {
      try {
        response.end()
      } catch (err: any) {
        // Ignore errors from already closed connections
      }
    }

    // Remove session
    this.sessions.delete(sessionId)

    // Respond with 204 No Content
    res.writeHead(204)
    res.end()
  }
}
