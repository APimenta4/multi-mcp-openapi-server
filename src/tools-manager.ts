import { Tool } from "@modelcontextprotocol/sdk/types.js"
import { OpenAPISpecLoader } from "./openapi-loader"
import { OpenAPIMCPServerConfig } from "./config"

/**
 * Manages the tools available in the MCP server
 */
export class ToolsManager {
  private tools: Map<string, Tool> = new Map()
  private specLoader: OpenAPISpecLoader

  constructor(private config: OpenAPIMCPServerConfig) {
    this.specLoader = new OpenAPISpecLoader()
  }

  /**
   * Initialize tools from the OpenAPI specification
   */
  async initialize(): Promise<void> {
    const specs = await this.specLoader.loadOpenAPISpec(this.config.specsDirectory)

    for (const [providerName, spec] of specs.entries()) {
      // Parse tools from each OpenAPI specification
      // spec should be the first element in the touple
      const skibidi = spec[0]
      const parsedTools = this.specLoader.parseOpenAPISpec(providerName, spec)

      // Add tools to the manager
      for (const [toolId, tool] of parsedTools.entries()) {
        this.tools.set(toolId, tool)
        console.log(`[${providerName}] Added tool: ${toolId} (${tool.name})`)
        // print all "tool" attributes
        console.log(`[${providerName}] Tool attributes: ${JSON.stringify(tool, null, 2)}`)
      }
    }
  }

  /**
   * Get all available tools
   */
  getAllTools(): Tool[] {

    return Array.from(this.tools.values())
  }

  /**
   * Find a tool by ID or name
   */
  findTool(idOrName: string): { toolId: string; tool: Tool } | undefined {
    // Try to find by ID first
    if (this.tools.has(idOrName)) {
      return { toolId: idOrName, tool: this.tools.get(idOrName)! }
    }

    // Then try to find by name
    for (const [toolId, tool] of this.tools.entries()) {
      if (tool.name === idOrName) {
        return { toolId, tool }
      }
    }

    return undefined
  }

  /**
   * Get the path and method from a tool ID
   */
  parseToolId(toolId: string): { method: string; path: string } {
    const [method, ...pathParts] = toolId.split("-")
    const path = "/" + pathParts.join("/").replace(/-/g, "/")
    return { method, path }
  }
}
