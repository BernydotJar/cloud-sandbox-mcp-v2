#!/usr/bin/env node
// Reproducible stdio MCP smoke test for sandbox-local PdfCraft.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const project = resolve(process.cwd());
assert.match(project, /^\/workspace\/projects\/[^/]+$/, 'Run from a sandbox project root');
const artifacts = join(project, 'artifacts', 'artcraft');
mkdirSync(artifacts, { recursive: true });
const temp = mkdtempSync(join(artifacts, 'smoke-'));
const fixture = join(temp, 'sample.pdf');
const saved = join(temp, 'output.pdf');

function samplePdf() {
  const stream = 'BT /F1 20 Tf 40 120 Td (ArtCraft MCP verified) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return pdf;
}

writeFileSync(fixture, samplePdf());
const client = new Client({ name: 'artcraft-sandbox-smoke', version: '1.0.0' }, { capabilities: {} });
const started = Date.now();
const report = {
  capability: 'artcraft-pdfcraft',
  project,
  checks: {},
  artifacts: ['artifacts/artcraft/last-smoke.json'],
};
let connected = false;
try {
  const transport = new StdioClientTransport({ command: '/workspace/.local/bin/pdfcraft-mcp', args: [], stderr: 'pipe' });
  await client.connect(transport);
  connected = true;
  report.checks.mcp_connect = 'PASS';

  const names = (await client.listTools()).tools.map(t => t.name);
  for (const expected of ['doc_open', 'doc_info', 'text_extract', 'doc_save', 'tool_search']) {
    assert.ok(names.includes(expected), `Missing MCP tool: ${expected}`);
  }
  report.checks.tool_discovery = 'PASS';
  report.tool_count = names.length;

  const opened = await client.callTool({ name: 'doc_open', arguments: { path: fixture } });
  assert.equal(opened.isError, false);
  const doc = opened.structuredContent?.doc;
  assert.equal(typeof doc, 'number');
  report.checks.doc_open = 'PASS';

  const info = await client.callTool({ name: 'doc_info', arguments: { doc } });
  assert.equal(info.isError, false);
  assert.equal(info.structuredContent?.pages?.length, 1);
  report.checks.doc_info = 'PASS';

  const extracted = await client.callTool({ name: 'text_extract', arguments: { doc } });
  assert.equal(extracted.isError, false);
  const flat = JSON.stringify(extracted.structuredContent ?? extracted.content);
  assert.ok(flat.includes('ArtCraft MCP verified'));
  report.checks.text_extract = 'PASS';

  const output = await client.callTool({ name: 'doc_save', arguments: { doc, path: saved } });
  assert.equal(output.isError, false);
  assert.ok(existsSync(saved) && readFileSync(saved).subarray(0, 5).toString() === '%PDF-');
  report.checks.doc_save = 'PASS';

  const external = await client.callTool({ name: 'doc_open', arguments: { path: '/workspace/.local/share/artcraft-smoke/hello.pdf' } });
  assert.equal(external.isError, true, 'Opening a document outside project scope should fail');
  report.checks.read_outside_project_denied = 'PASS';

  const blockedOutput = await client.callTool({ name: 'doc_save', arguments: { doc, path: '/workspace/artcraft-blocked.pdf' } });
  assert.equal(blockedOutput.isError, true, 'Saving outside output scope should fail');
  assert.equal(existsSync('/workspace/artcraft-blocked.pdf'), false);
  report.checks.write_outside_project_denied = 'PASS';

  const closed = await client.callTool({ name: 'doc_close', arguments: { doc } });
  assert.equal(closed.isError, false);
  report.checks.doc_close = 'PASS';
  report.decision = 'PASS';
} catch (error) {
  report.decision = 'FAIL';
  report.error = String(error);
  process.exitCode = 1;
} finally {
  report.elapsed_ms = Date.now() - started;
  if (connected) await client.close();
  rmSync(temp, { recursive: true, force: true });
  const reportPath = join(artifacts, 'last-smoke.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
