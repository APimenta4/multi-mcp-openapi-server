import { Tool } from "@modelcontextprotocol/sdk/types.js"
import { OpenAPISpecsLoader } from "./openapi-loader"
import { OpenAPIMCPServerConfig } from "./config"

/**
 * Manages the tools available in the MCP server
 */

export interface ExtendedTool extends Tool {
  url: string;
  headers: Record<string, string> | undefined;
  path: string;
  method: string;
  params: Record<string, any> | undefined;
}

export class ToolsManager {
  private tools: Map<string, ExtendedTool> = new Map()
  private specsLoader: OpenAPISpecsLoader

  constructor(private config: OpenAPIMCPServerConfig) {
    this.specsLoader = new OpenAPISpecsLoader()
  }

  /**
   * Initialize tools from the OpenAPI specification
   */
  async initialize(): Promise<void> {
    // Load OpenAPI specifications from the specified directory
    const preparedTools = await this.specsLoader.loadOpenAPISpecs(this.config.specsDirectory)

    for (const [providerName, preparedTool] of preparedTools.entries()) {
      // Parse tools from each OpenAPI specification
      const parsedTools = this.specsLoader.parseOpenAPISpec(providerName, preparedTool)

      // Add tools to the manager
      for (const [toolId, tool] of parsedTools.entries()) {
        this.tools.set(toolId, tool)
        console.log(`[${providerName}] Added tool: ${toolId} (${tool.name})`)
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
  findTool(idOrName: string): { toolId: string; tool: ExtendedTool } | undefined {
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
