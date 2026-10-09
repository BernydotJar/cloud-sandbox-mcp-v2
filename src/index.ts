import type { Request, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { createMcpServer } from './mcp/server.js';
import { DockerRuntime } from './runtime/docker.js';
import { ComputerUseService } from './services/computer-use-service.js';
import { WorkspaceService } from './services/workspace-service.js';
import { WorkspaceStore } from './store/workspace-store.js';

const store = new WorkspaceStore(config.dataDir, config.hostDataDir);
const docker = new DockerRuntime(config);
const service = new WorkspaceService(config, store, docker);
const computer = new ComputerUseService(config);
await service.initialize();

const app = createMcpExpressApp({ host: config.BIND_HOST, allowedHosts: config.allowedHosts });
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'cloud-sandbox-mcp', version: '0.2.0' });
});

app.post(config.mcpPath, async (req: Request, res: Response) => {
  const server = createMcpServer(service, computer);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request failed', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
});

app.get(config.mcpPath, (_req: Request, res: Response) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});
app.delete(config.mcpPath, (_req: Request, res: Response) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

const httpServer = app.listen(config.PORT, config.BIND_HOST, () => {
  console.log(`cloud-sandbox-mcp listening on http://${config.BIND_HOST}:${config.PORT}${config.mcpPath}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down.`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
