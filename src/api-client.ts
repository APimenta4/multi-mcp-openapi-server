import axios, { AxiosInstance, AxiosError } from "axios"
import { ExtendedTool } from "./tools-manager.js"

/**
 * Client for making API calls to the backend service
 */
export class ApiClient {
  private axiosInstance: AxiosInstance

  constructor() {
    this.axiosInstance = axios.create({})
  }

  /**
   * Execute an API call based on the tool ID and parameters
   *
   * @param toolId - The tool ID in format METHOD-path-parts
   * @param params - Parameters for the API call
   * @returns The API response data
   */
  async executeApiCall(tool: ExtendedTool, params: Record<string, any>): Promise<any> {
    try {
      // Prepare request configuration
      const config: any = {
        method: tool.method,
        baseURL: tool.url,
        url: tool.path,
        headers: tool.headers,
      }

      // TODO: fix inputschema and params bullshit
      for (const [paramName, value] of Object.entries(params)) {
        // Check if the parameter is in the tool's input schema
        if (tool.inputSchema.properties && tool.inputSchema.properties[paramName]) {
          // Check if the parameter is required and not provided
          if (tool.params && tool.params[paramName] && value === undefined) {
            throw new Error(`Missing required parameter: ${paramName}`)
          }

          if(tool.params && tool.params[paramName]){
            if(tool.params[paramName].in === "query"){
              // Process query parameters
              config.params = this.processQueryParams({
                ...config.params,
                [paramName]: value,
              })
            }else{
              // Process url parameters
              config.url = config.url.replace(
                `{${paramName}}`,
                encodeURIComponent(value),
              )
            }
          }
        }
      }

      // Execute the request
      const response = await this.axiosInstance(config)
      return response.data
    } catch (error) {
      // Handle errors
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError
        throw new Error(
          `API request failed: ${axiosError.message}${
            axiosError.response
              ? ` (${axiosError.response.status}: ${
                  typeof axiosError.response.data === "object"
                    ? JSON.stringify(axiosError.response.data)
                    : axiosError.response.data
                })`
              : ""
          }`,
        )
      }
      throw error
    }
  }

  /**
   * Process query parameters for GET requests
   * Converts arrays to comma-separated strings
   *
   * @param params - The original parameters
   * @returns Processed parameters
   */
  private processQueryParams(
    params: Record<string, any>,
  ): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {}

    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        result[key] = value.join(",")
      } else {
        result[key] = value
      }
    }

    return result
  }
}
