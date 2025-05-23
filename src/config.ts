import yargs from "yargs"
import { hideBin } from "yargs/helpers"

export interface OpenAPIMCPServerConfig {
  name: string
  version: string
  specsDirectory: string
  transportType: "stdio" | "http"
  httpPort?: number
  httpHost?: string
  endpointPath?: string
}

/**
 * Parse header string in format 'key1:value1,key2:value2' into a record
 */
export function parseHeaders(headerStr?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (headerStr) {
    headerStr.split(",").forEach((header) => {
      const [key, value] = header.split(":")
      if (key && value) headers[key.trim()] = value.trim()
    })
  }
  return headers
}

/**
 * Load configuration from command line arguments and environment variables
 */
export function loadConfig(): OpenAPIMCPServerConfig {
  const argv = yargs(hideBin(process.argv))
    .option("transport", {
      alias: "t",
      type: "string",
      choices: ["stdio", "http"],
      description: "Transport type to use (stdio or http)",
    })
    .option("port", {
      alias: "p",
      type: "number",
      description: "HTTP port for HTTP transport",
    })
    .option("host", {
      type: "string",
      description: "HTTP host for HTTP transport",
    })
    .option("path", {
      type: "string",
      description: "HTTP endpoint path for HTTP transport",
    })
    .option("specs-dir", {
      alias: "s",
      type: "string",
      description: "Path to directory containing OpenAPI specifications",
    })
    .option("name", {
      alias: "n",
      type: "string",
      description: "Server name",
    })
    .option("version", {
      alias: "v",
      type: "string",
      description: "Server version",
    })
    .help()
    .parseSync()

  // Transport configuration
  // Determine transport type, ensuring only 'stdio' or 'http'
  let transportType: "stdio" | "http"
  if (argv.transport === "http" || process.env.TRANSPORT_TYPE === "http") {
    transportType = "http"
  } else {
    transportType = "stdio"
  }

  const httpPort = argv.port ?? (process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT, 10) : 3000)
  const httpHost = argv.host || process.env.HTTP_HOST || "127.0.0.1"
  const endpointPath = argv.path || process.env.ENDPOINT_PATH || "/mcp"

  // Combine CLI args and env vars, with CLI taking precedence
  const specsDirectory = argv["specs-dir"] || process.env.OPENAPI_SPECS_PATH

  if (!specsDirectory) {
    throw new Error("OpenAPI specs directory is required (--specs-dir or OPENAPI_SPECS_PATH)")
  }

  return {
    name: argv.name || process.env.SERVER_NAME || "mcp-openapi-server",
    version: argv.version || process.env.SERVER_VERSION || "1.0.0",
    specsDirectory,
    transportType,
    httpPort,
    httpHost,
    endpointPath,
  }
}
