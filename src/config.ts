import path from 'node:path';
import { z } from 'zod/v4';

const booleanString = z.string().default('false').transform(value => value === 'true');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  BIND_HOST: z.string().default('127.0.0.1'),
  MCP_DATA_DIR: z.string().default('/var/lib/cloud-sandbox-mcp'),
  HOST_DATA_DIR: z.string().optional(),
  MCP_PATH_SECRET: z.string().min(16).default('development-secret-change-me'),
  SANDBOX_IMAGE: z.string().default('cloud-sandbox-workstation:latest'),
  SANDBOX_MODE: z.enum(['hardened', 'workstation']).default('workstation'),
  SANDBOX_NETWORK: z.enum(['bridge', 'none']).default('bridge'),
  SANDBOX_MEMORY: z.string().default('8g'),
  SANDBOX_CPUS: z.string().default('4'),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().positive().default(2048),
  INNER_DOCKER_STORAGE_DRIVER: z.enum(['vfs', 'overlay2']).default('vfs'),
  COMMAND_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  COMMAND_MAX_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(3600),
  MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(500_000),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(5_000_000),
  ALLOWED_GIT_HOSTS: z.string().default('github.com'),
  ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1'),
  ENABLE_GIT_PUSH: booleanString,
  ENABLE_WORKSPACE_DESTROY: booleanString,
  ENABLE_RUNTIME_RECREATE: z.string().default('true').transform(value => value === 'true'),
  GIT_AUTHOR_NAME: z.string().default('ChatGPT Sandbox Agent'),
  GIT_AUTHOR_EMAIL: z.string().email().default('chatgpt-sandbox@example.invalid'),
  GITHUB_TOKEN: z.string().optional(),
  COMPUTER_USE_ENABLED: booleanString,
  COMPUTER_USE_BRIDGE_URL: z.string().default('http://host.docker.internal:9764'),
  COMPUTER_USE_BRIDGE_TOKEN: z.string().optional()
});

const parsed = envSchema.parse(process.env);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const insecureSecrets = new Set(['development-secret-change-me', 'replace-with-a-long-random-value']);
if (!loopbackHosts.has(parsed.BIND_HOST) && insecureSecrets.has(parsed.MCP_PATH_SECRET)) {
  throw new Error('MCP_PATH_SECRET is still a placeholder. Run ./scripts/bootstrap.sh, then recreate the service with ./scripts/setup.sh.');
}
if (parsed.COMPUTER_USE_ENABLED) {
  if (!parsed.COMPUTER_USE_BRIDGE_TOKEN || parsed.COMPUTER_USE_BRIDGE_TOKEN.length < 32) {
    throw new Error('COMPUTER_USE_ENABLED requires a separate COMPUTER_USE_BRIDGE_TOKEN (32+ chars).');
  }
  const bridge = new URL(parsed.COMPUTER_USE_BRIDGE_URL);
  if (bridge.protocol !== 'http:' || bridge.username || bridge.password || bridge.pathname !== '/' || bridge.search || bridge.hash || !['host.docker.internal', '127.0.0.1', 'localhost'].includes(bridge.hostname)) {
    throw new Error('COMPUTER_USE_BRIDGE_URL must use an approved local Docker host endpoint.');
  }
}
const dataDir = path.resolve(parsed.MCP_DATA_DIR);
const hostDataDir = path.resolve(parsed.HOST_DATA_DIR ?? parsed.MCP_DATA_DIR);

export const config = {
  ...parsed,
  dataDir,
  hostDataDir,
  workstationMode: parsed.SANDBOX_MODE === 'workstation',
  allowedGitHosts: new Set(parsed.ALLOWED_GIT_HOSTS.split(',').map(value => value.trim()).filter(Boolean)),
  allowedHosts: parsed.ALLOWED_HOSTS.split(',').map(value => value.trim()).filter(Boolean),
  mcpPath: `/mcp/${parsed.MCP_PATH_SECRET}`
};

export type AppConfig = typeof config;
