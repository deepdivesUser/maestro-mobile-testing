#!/usr/bin/env node
/**
 * AI-Powered Maestro Flow Generator
 *
 * Converts natural language descriptions into Maestro YAML test flows
 * using an OpenAI-compatible LLM API.
 *
 * Usage:
 *   ./scripts/ai-generate.mjs "Log in with valid credentials"
 *   ./scripts/ai-generate.mjs "Test search returns results" --category regression
 *   ./scripts/ai-generate.mjs --file description.md --output custom-flow.yaml
 *   ./scripts/ai-generate.mjs --dry-run "Launch app and check home screen"
 *   echo "Describe test..." | ./scripts/ai-generate.mjs --stdin
 *   ./scripts/ai-generate.mjs --edit auth/login-success.yaml "add screenshot after login"
 *
 * Environment:
 *   Loads .env.ai for provider config, or use env vars directly:
 *     AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_BASE_URL, AI_TEMPERATURE, AI_MAX_TOKENS
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const FLOW_DIR = join(PROJECT_ROOT, '.maestro', 'flows');
const ENV_AI_PATH = join(PROJECT_ROOT, '.env.ai');
const SCHEMA_PATH = join(__dirname, 'maestro-schema.txt');

// Read Maestro schema from external file (avoids template literal ${} conflicts)
const MAESTRO_SCHEMA = readFileSync(SCHEMA_PATH, 'utf8');

// ─── Helpers (exported for ai-interactive.mjs) ──────────────────────────────

export function loadEnv(path) {
  const config = {};
  if (!existsSync(path)) return config;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    config[key] = val;
  }
  return config;
}

export function readYamlFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      const fullPath = join(entry.parentPath || dir, entry.name);
      files.push({
        name: fullPath.replace(PROJECT_ROOT + '/', ''),
        content: readFileSync(fullPath, 'utf8'),
      });
    }
  }
  return files;
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function inferCategory(description) {
  const desc = description.toLowerCase();
  if (/\b(login|log.?in|sign.?in|auth|signup|sign.?up|register|logout|log.?out|password|credential)\b/.test(desc))
    return 'auth';
  if (/\b(e2e|end.?to.?end|full.?journey|complete|entire|multi.?step|workflow)\b/.test(desc))
    return 'e2e';
  if (/\b(regression|bug|fix|broken|incorrect|wrong|issue|navigation|scroll|back)\b/.test(desc))
    return 'regression';
  if (/\b(smoke|launch|start|open|basic|sanity|quick)\b/.test(desc))
    return 'smoke';
  if (/\b(reusable|helper|util|common|shared|macro|subflow)\b/.test(desc))
    return 'common';
  return 'regression'; // default
}

export function resolveBaseUrl(provider, baseUrl) {
  if (baseUrl) return baseUrl.replace(/\/+$/, '');
  switch (provider) {
    case 'ollama': return 'http://localhost:11434/v1';
    case 'openai': return 'https://api.openai.com/v1';
    case 'anthropic': return 'https://api.anthropic.com/v1';
    case 'azure': return 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT';
    default: return 'https://api.openai.com/v1';
  }
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(args) {
  const opts = {
    description: '',
    category: null,
    output: null,
    file: null,
    stdin: false,
    dryRun: false,
    verbose: false,
    context: true,
    noContext: false,
    edit: null,
    list: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--category': case '-c':
        opts.category = args[++i]; break;
      case '--output': case '-o':
        opts.output = args[++i]; break;
      case '--file': case '-f':
        opts.file = args[++i]; break;
      case '--stdin':
        opts.stdin = true; break;
      case '--dry-run': case '-d':
        opts.dryRun = true; break;
      case '--verbose': case '-v':
        opts.verbose = true; break;
      case '--no-context':
        opts.context = false; break;
      case '--edit': case '-e':
        opts.edit = args[++i]; break;
      case '--list': case '-l':
        opts.list = true; break;
      case '--help': case '-h':
        opts.help = true; break;
      default:
        if (!arg.startsWith('-')) {
          opts.description = arg;
        }
        break;
    }
  }
  return opts;
}

// ─── LLM Client ──────────────────────────────────────────────────────────────

export async function callLLM(config, systemPrompt, userPrompt) {
  const baseUrl = resolveBaseUrl(config.AI_PROVIDER, config.AI_BASE_URL);
  const url = baseUrl + '/chat/completions';

  const headers = { 'Content-Type': 'application/json' };
  if (config.AI_PROVIDER === 'anthropic' && !config.AI_BASE_URL) {
    headers['x-api-key'] = config.AI_API_KEY;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = 'Bearer ' + config.AI_API_KEY;
  }

  const body = {
    model: config.AI_MODEL,
    temperature: parseFloat(config.AI_TEMPERATURE) || 0.2,
    max_tokens: parseInt(config.AI_MAX_TOKENS) || 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('LLM API error (' + response.status + '): ' + errorText);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── Extract YAML from LLM response ──────────────────────────────────────────

export function extractYaml(text) {
  // Try fenced code block first
  const fenceMatch = text.match(/```(?:ya?ml)?\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // If the whole response looks like YAML (starts with - or appId or comment)
  if (/^\s*(appId:|#|\-\s)/m.test(text)) {
    return text.trim();
  }

  // Fall back to raw text
  return text.trim();
}

// ─── Help text ───────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
🤖 Maestro AI Flow Generator

Usage:
  ./scripts/ai-generate.mjs "<natural language description>" [options]
  ./scripts/ai-generate.mjs --file description.md [options]
  ./scripts/ai-generate.mjs --stdin [options]
  ./scripts/ai-generate.mjs --edit <flow.yaml> "<changes in natural language>"

Options:
  -c, --category <cat>   Flow category: auth|smoke|regression|e2e|common
  -o, --output <file>    Output file path (relative to .maestro/flows/)
  -f, --file <file>      Read description from a markdown/text file
      --stdin             Read description from stdin
  -d, --dry-run          Print YAML to stdout without writing file
  -v, --verbose          Show full LLM prompt and response
      --no-context        Don't include existing flows as context
  -e, --edit <file>      Edit an existing flow using natural language
  -l, --list             List all existing flows (for reference)
  -h, --help             Show this help

Environment (.env.ai or env vars):
  AI_PROVIDER   openai|anthropic|ollama|azure  (default: openai)
  AI_API_KEY    Your API key
  AI_MODEL      Model name  (default: gpt-4o)
  AI_BASE_URL   Custom endpoint URL
  AI_TEMPERATURE Generation temp  (default: 0.2)
  AI_MAX_TOKENS Max output tokens  (default: 2048)

Examples:
  ./scripts/ai-generate.mjs "Test that user can search for items and see results"
  ./scripts/ai-generate.mjs "Verify password reset flow sends email" -c auth
  ./scripts/ai-generate.mjs "Add screenshot after login step" --edit auth/login-success.yaml
  ./scripts/ai-generate.mjs -d "Smoke test: app launches without crash"
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  // --- Help ---
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // --- List mode ---
  if (opts.list) {
    const flows = readYamlFiles(FLOW_DIR);
    console.log('\n📋 Existing Maestro flows:\n');
    for (const f of flows) {
      const comment = f.content.split('\n').find(l => l.startsWith('#')) || '';
      console.log('  ' + f.name + '  ' + comment.trim());
    }
    console.log('\n  Total: ' + flows.length + ' flow(s)\n');
    process.exit(0);
  }

  // --- Load AI config ---
  const envConfig = loadEnv(ENV_AI_PATH);
  const config = {
    AI_PROVIDER: process.env.AI_PROVIDER || envConfig.AI_PROVIDER || 'openai',
    AI_API_KEY: process.env.AI_API_KEY || envConfig.AI_API_KEY || '',
    AI_MODEL: process.env.AI_MODEL || envConfig.AI_MODEL || 'gpt-4o',
    AI_BASE_URL: process.env.AI_BASE_URL || envConfig.AI_BASE_URL || '',
    AI_TEMPERATURE: process.env.AI_TEMPERATURE || envConfig.AI_TEMPERATURE || '0.2',
    AI_MAX_TOKENS: process.env.AI_MAX_TOKENS || envConfig.AI_MAX_TOKENS || '2048',
  };

  if (!config.AI_API_KEY) {
    console.error('❌ No AI_API_KEY found. Set it in .env.ai or as an environment variable.');
    process.exit(1);
  }

  // --- Get description ---
  let description = opts.description;

  if (opts.file) {
    const filePath = resolve(opts.file);
    if (!existsSync(filePath)) {
      console.error('❌ File not found: ' + opts.file);
      process.exit(1);
    }
    description = readFileSync(filePath, 'utf8').trim();
  }

  if (opts.stdin && !description) {
    const rl = createInterface({ input: process.stdin });
    description = await new Promise((res) => {
      const lines = [];
      rl.on('line', (line) => lines.push(line));
      rl.on('close', () => res(lines.join('\n')));
    });
  }

  // --- Edit mode ---
  let existingFlow = null;
  let existingPath = null;
  if (opts.edit) {
    const editPath = opts.edit.startsWith('/') ? opts.edit : resolve(PROJECT_ROOT, opts.edit);
    if (!existsSync(editPath)) {
      const altPath = join(FLOW_DIR, opts.edit);
      if (!existsSync(altPath)) {
        console.error('❌ Flow file not found: ' + opts.edit);
        console.error('   Tried: ' + editPath);
        console.error('   Tried: ' + altPath);
        process.exit(1);
      }
      existingPath = altPath;
    } else {
      existingPath = editPath;
    }
    existingFlow = readFileSync(existingPath, 'utf8');
    if (!description) {
      console.error('❌ Please provide a description of the changes to make.');
      process.exit(1);
    }
  }

  if (!description && !opts.edit) {
    console.error('❌ No description provided. Pass a description as an argument, --file, or --stdin.');
    console.error('   Run with --help for usage information.');
    process.exit(1);
  }

  // --- Build context ---
  const contextFlows = opts.context ? readYamlFiles(FLOW_DIR) : [];

  // --- Resolve output path ---
  const category = opts.category || inferCategory(description);
  const outputDir = join(FLOW_DIR, category);
  let outputPath;

  if (opts.edit) {
    outputPath = existingPath;
  } else if (opts.output) {
    outputPath = opts.output.startsWith('/') ? opts.output : join(PROJECT_ROOT, opts.output);
  } else {
    const slug = slugify(description);
    outputPath = join(outputDir, slug + '.yaml');
  }

  // --- Build system prompt ---
  const systemPrompt =
    'You are an expert Maestro mobile test automation engineer. You generate valid Maestro YAML flow files from natural language descriptions.\n\n' +
    MAESTRO_SCHEMA +
    '\n\n## PROJECT CONVENTIONS\n\n' +
    'The project uses these conventions (follow them exactly):\n\n' +
    '1. Every flow starts with a comment describing the test purpose\n' +
    '2. Every flow starts with: appId: ${APP_ID:-com.example.app}\n' +
    '3. Every flow starts with: - launchApp\n' +
    '4. Every flow ends with: - runFlow: ".maestro/flows/common/assert-no-crash-dialog.yaml"\n' +
    '5. Use ${ENV_VAR:-default} for dynamic values (especially APP_ID, TEST_EMAIL, TEST_PASSWORD)\n' +
    '6. Reuse subflows from common/ when appropriate (skip-onboarding.yaml, take-screenshot.yaml, assert-no-crash-dialog.yaml)\n' +
    '7. Use optional: true on elements that might not always be present (e.g., onboarding, dialogs)\n' +
    '8. Add inline comments (#) to explain non-obvious steps\n' +
    '9. Keep flows focused — one scenario per file\n' +
    '10. Use descriptive file names in kebab-case\n\n' +
    '## OUTPUT FORMAT\n\n' +
    'Output ONLY valid YAML. No markdown, no explanation, no wrapping. Just the YAML content ready to save as a .yaml file.\n\n' +
    'If you are editing an existing flow, output the COMPLETE updated flow, not just the changes.';

  // --- Build user prompt ---
  let userPrompt = '';

  // Include context flows as few-shot examples
  if (contextFlows.length > 0) {
    userPrompt += '## EXISTING FLOWS IN THIS PROJECT (use as style reference)\n\n';
    for (const flow of contextFlows.slice(0, 8)) { // Limit to 8 examples
      userPrompt += '### ' + flow.name + '\n```yaml\n' + flow.content + '\n```\n\n';
    }
  }

  if (opts.edit) {
    userPrompt +=
      '## TASK: EDIT EXISTING FLOW\n\n' +
      'Here is the current flow file (' + opts.edit + '):\n\n' +
      '```yaml\n' + existingFlow + '\n```\n\n' +
      'Make the following changes:\n' + description + '\n\n' +
      'Output the COMPLETE updated flow file.';
  } else {
    userPrompt +=
      '## TASK: GENERATE NEW FLOW\n\n' +
      'Generate a Maestro YAML flow file for this test scenario:\n\n' +
      description + '\n\n' +
      'Category: ' + category + '\n' +
      'Output filename: ' + (opts.output || slugify(description) + '.yaml');
  }

  // --- Call LLM ---
  console.log('\n🤖 Generating Maestro flow...');
  console.log('   Provider: ' + config.AI_PROVIDER);
  console.log('   Model:    ' + config.AI_MODEL);
  console.log('   Category: ' + category);
  if (opts.dryRun) console.log('   Mode:     dry-run (stdout only)');
  console.log();

  if (opts.verbose) {
    console.log('─── System Prompt ───');
    console.log(systemPrompt);
    console.log('─── User Prompt ───');
    console.log(userPrompt);
    console.log('─── End Prompts ───\n');
  }

  const rawResponse = await callLLM(config, systemPrompt, userPrompt);
  const yaml = extractYaml(rawResponse);

  if (opts.verbose) {
    console.log('─── Raw LLM Response ───');
    console.log(rawResponse);
    console.log('─── End Raw Response ───\n');
  }

  // --- Output ---
  if (opts.dryRun) {
    console.log('─── Generated YAML (dry-run) ───\n');
    console.log(yaml);
    console.log('\n─── End YAML ───\n');
  } else {
    // Ensure directory exists
    const outDir = dirname(outputPath);
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
      console.log('   Created directory: ' + outDir);
    }

    writeFileSync(outputPath, yaml + '\n', 'utf8');
    console.log('\n✅ Flow written to: ' + outputPath.replace(PROJECT_ROOT + '/', '') + '\n');

    // Basic YAML structure validation
    const lines = yaml.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    if (lines.length === 0) {
      console.warn('⚠️  Warning: Generated YAML appears empty');
    } else if (lines[0].startsWith('- ') || lines[0].startsWith('appId:') || lines[0].startsWith('env:')) {
      console.log('   ✓ YAML structure looks valid');
    } else {
      console.warn('⚠️  Warning: Generated YAML may not be valid Maestro format');
      console.warn('   First non-comment line: ' + lines[0]);
    }

    console.log('\n   Run it with:');
    console.log('     make test-' + category + '    # or: maestro test --env APP_ID=... ' + outputPath.replace(PROJECT_ROOT + '/', ''));
    console.log();
  }
}

main().catch((err) => {
  console.error('\n❌ Error: ' + err.message + '\n');
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
