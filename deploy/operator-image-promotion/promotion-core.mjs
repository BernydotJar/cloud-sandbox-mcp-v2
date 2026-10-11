import assert from 'node:assert/strict';

export const ORIGINAL_IMAGE = 'sha256:55be5b2aa44d164a777b87f55d46f351d56fe0463a6527f6efad96918567fdcb';
export const V2_IMAGE = 'sha256:b7d9847967ddc0d08ad665b68f8309b22b743857f176741791efbb1925d2f201';
export const V2_TAG = 'cloud-sandbox-mcp:deps-v2-55be5b2aa44d-d1b4b0f9afe9';
export const BASE_TAG = 'cloud-sandbox-mcp:base-55be5b2aa44d164a';

export const REQUIRED = Object.freeze({
  '@modelcontextprotocol/sdk': '1.32.1',
  'express':'5.3.0',
  '@hono/node-server':'2.1.4',
  'fast-uri':'3.1.8',
  'hono':'4.13.13',
  'ip-address':'10.7.3',
  'proxy-addr':'2.0.8',
  'qs':'6.16.0'
});

export function overlayFor(image) {
  if (![V2_TAG,BASE_TAG].includes(image)) throw Error('IMAGE_NOT_RELEASE_APPROVED');
  return 'services:\n  mcp:\n    image: ' + image + '\n';
}
export function comparableConfig(value) {
  if (!value || typeof value!=='object' || !value.services?.mcp) {
    throw Error('INVALID_COMPOSE_CONFIG');
  }
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.services.mcp.image;
  return copy;
}
export function confirmOnlyImageChanged(before,after,expectedImage) {
  if (after?.services?.mcp?.image!==expectedImage) {
    throw Error('TARGET_IMAGE_OVERRIDE_MISSING');
  }
  try {assert.deepStrictEqual(comparableConfig(before),comparableConfig(after));}
  catch {throw Error('COMPOSE_CONFIG_DRIFT');}
  return true;
}
export function verifyControllerMetadata(items) {
  if (!Array.isArray(items) || items.length!==1 ||
      items[0]?.Config?.Labels?.['com.docker.compose.service']!=='mcp' ||
      !items[0]?.State?.Running ||
      !/^[a-f0-9]{64}$/.test(items[0]?.Id||'') ||
      !/^sha256:[a-f0-9]{64}$/.test(items[0]?.Image||'')) {
    throw Error('CONTROLLER_IDENTITY_OR_RUNTIME_DRIFT');
  }
  return items[0];
}
