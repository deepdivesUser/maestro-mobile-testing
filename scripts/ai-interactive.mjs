#!/usr/bin/env node
/**
 * AI-Powered Maestro Flow Generator — Interactive Mode
 *
 * A REPL for iteratively generating, editing, and refining Maestro flows
 * using natural language.
 *
 * Usage:
 *   ./scripts/ai-interactive.mjs
 *
 * Commands within the REPL:
 *   <description>          Generate a new flow
 *   @edit <flow.yaml>      Switch to editing an existing flow
 *   @list                  List all existing flows
 *   @show                  Show the last generated flow
 *   @save [path]           Save the last generated flow
 *   @run                   Run the last saved flow via maestro
 *   @dry                   Toggle dry-run mode
 *   @verbose               Toggle verbose mode
 *   @category <cat>        Set default category
 *   @model <name>          Switch LLM model
 *   @reset                 Clear conversation history
 *   @help                  Show help
 *   @quit / @exit          Exit
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { execSync } from 'child_process';

import {
  loadEnv,
  readYamlFiles,
  inferCategory,
  slugify,
  resolveBaseUrl,
  callLLM,
  extractYaml,
} from './ai-generate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const FLOW_DIR = join(PROJECT_ROOT, '.maestro', 'flows');
const ENV_AI_PATH = join(PROJECT_ROOT, '.env.ai');
const SCHEMA_PATH = join(__dirname, 'maestro-schema.txt');

const MAESTRO_SCHEMA = readFileSync(SCHEMA_PATH, 'utf8');

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  messages: [],        // conversation history for multi-turn
  lastYaml: null,
  lastPath: null,
  editingFlow: null,   // path to flow being edited
  dryRun: false,
  verbose: false,
  category: null,
  turnCount: 0,
};

// ─── Config ──────────────────────────────────────────────────────────────────

const envConfig = loadEnv(ENV_AI_PATH);
const config = {
  AI_PROVIDER: process.env.AI_PROVIDER || envConfig.AI_PROVIDER || 'openai',
  AI_API_KEY: process.env.AI_API_KEY || envConfig.AI_API_KEY || '',
  AI_MODEL: process.env.AI_MODEL || envConfig.AI_MODEL || 'gpt-4o',
  AI_BASE_URL: process.env.AI_BASE_URL || envConfig.AI_BASE_URL || '',
  AI_TEMPERATURE: process.env.AI_TEMPERATURE || envConfig.AI_TEMPERATURE || '0.3',
  AI_MAX_TOKENS: process.env.AI_MAX_TOKENS || envConfig.AI_MAX_TOKENS || '2048',
};

// ─── REPL ────────────────────────────────────────────────────────────────────

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'maestro-ai> ',
});

function prompt() {
  const parts = [];
  if (state.editingFlow) parts.push('editing:' + state.editingFlow.split('/').pop());
  if (state.dryRun) parts.push('dry-run');
  if (state.category) parts.push(state.category);
  const suffix = parts.length ? ' [' + parts.join(', ') + ']' : '';
  rl.setPrompt('maestro-ai' + suffix + '> ');
  rl.prompt();
}

async function handleInput(line) {
  const input = line.trim();
  if (!input) { prompt(); return; }

  // --- REPL commands ---
  if (input.startsWith('@')) {
    const [cmd, ...rest] = input.split(/\s+/);
    const arg = rest.join(' ');

    switch (cmd) {
      case '@edit': {
        if (!arg) {
          console.log('Usage: @edit <flow.yaml>');
          break;
        }
        const candidates = [
          resolve(PROJECT_ROOT, arg),
          join(FLOW_DIR, arg),
        ];
        const found = candidates.find(p => existsSync(p));
        if (!found) {
          console.log('❌ Flow not found: ' + arg);
          break;
        }
        state.editingFlow = found;
        const content = readFileSync(found, 'utf8');
        state.lastYaml = content;
        state.messages = [
          { role: 'user', content: 'Here is the current Maestro flow file (' + arg + '):\n\n' + content + '\n\nI will tell you what changes to make.' },
          { role: 'assistant', content: "I understand. I have the flow loaded. Please tell me what changes you'd like to make, and I'll output the complete updated flow." },
        ];
        console.log('\n✏️  Editing: ' + found.replace(PROJECT_ROOT + '/', ''));
        console.log('   Describe your changes. Use @show to see the current flow.\n');
        break;
      }

      case '@list': {
        const flows = readYamlFiles(FLOW_DIR);
        console.log('\n📋 ' + flows.length + ' flow(s):\n');
        for (const f of flows) {
          const comment = f.content.split('\n').find(l => l.startsWith('#')) || '';
          console.log('   ' + f.name.replace('.maestro/flows/', '') + '  ' + comment.trim());
        }
        console.log();
        break;
      }

      case '@show': {
        if (!state.lastYaml) {
          console.log('No flow generated yet.');
          break;
        }
        console.log('\n─── Last generated flow ' + (state.lastPath ? '(' + state.lastPath + ')' : '') + ' ───\n');
        console.log(state.lastYaml);
        console.log('\n─── End ───\n');
        break;
      }

      case '@save': {
        if (!state.lastYaml) {
          console.log('No flow to save.');
          break;
        }
        let savePath;
        if (state.editingFlow) {
          savePath = state.editingFlow;
        } else if (arg) {
          savePath = arg.startsWith('/') ? arg : resolve(PROJECT_ROOT, arg);
        } else {
          const cat = state.category || 'regression';
          const slug = 'ai-generated-' + Date.now().toString(36);
          savePath = join(FLOW_DIR, cat, slug + '.yaml');
        }
        const outDir = dirname(savePath);
        if (!existsSync(outDir)) {
          mkdirSync(outDir, { recursive: true });
        }
        writeFileSync(savePath, state.lastYaml + '\n', 'utf8');
        state.lastPath = savePath.replace(PROJECT_ROOT + '/', '');
        console.log('\n✅ Saved to: ' + state.lastPath + '\n');
        if (state.editingFlow) state.editingFlow = null;
        break;
      }

      case '@run': {
        if (!state.lastPath) {
          console.log('No saved flow to run. Use @save first.');
          break;
        }
        const fullPath = resolve(PROJECT_ROOT, state.lastPath);
        console.log('\n🏃 Running: ' + state.lastPath + '\n');
        try {
          execSync('maestro test --env APP_ID=' + (process.env.APP_ID || 'com.example.app') + ' "' + fullPath + '"', {
            stdio: 'inherit',
            cwd: PROJECT_ROOT,
          });
        } catch (e) {
          console.error('\n❌ maestro test failed');
        }
        console.log();
        break;
      }

      case '@dry': {
        state.dryRun = !state.dryRun;
        console.log('Dry-run: ' + (state.dryRun ? 'ON (print only)' : 'OFF (saves files)') + '\n');
        break;
      }

      case '@verbose': {
        state.verbose = !state.verbose;
        console.log('Verbose: ' + (state.verbose ? 'ON' : 'OFF') + '\n');
        break;
      }

      case '@category': {
        state.category = arg || null;
        console.log('Default category: ' + (state.category || '(auto-infer)') + '\n');
        break;
      }

      case '@model': {
        if (!arg) { console.log('Current model: ' + config.AI_MODEL); break; }
        config.AI_MODEL = arg;
        console.log('Model set to: ' + config.AI_MODEL + '\n');
        break;
      }

      case '@reset': {
        state.messages = [];
        state.lastYaml = null;
        state.lastPath = null;
        state.editingFlow = null;
        state.turnCount = 0;
        console.log('🔄 Conversation reset.\n');
        break;
      }

      case '@help': {
        console.log(`
📋 Available commands:

  <description>          Generate a new flow from natural language
  @edit <flow.yaml>      Load an existing flow for editing
  @list                  List all existing flows
  @show                  Show the last generated/edited flow
  @save [path]           Save the last flow (path optional)
  @run                   Run the last saved flow via maestro
  @dry                   Toggle dry-run mode (print only, no save)
  @verbose               Toggle verbose mode (show prompts/responses)
  @category <cat>        Set default category (auth|smoke|regression|e2e|common)
  @model <name>          Switch LLM model on the fly
  @reset                 Clear conversation history
  @help                  Show this help
  @quit / @exit          Exit

  Tips:
  - On first message, existing flows are included as context automatically.
  - Say "make it more robust" or "add error handling" to refine.
  - Use @edit to iterate on a specific file, then @save to write it.
  - Use @dry to preview before saving.
`);
        break;
      }

      case '@quit':
      case '@exit':
        console.log('👋 Goodbye!\n');
        process.exit(0);

      default:
        console.log('Unknown command: ' + cmd + '. Type @help for available commands.');
    }
    prompt();
    return;
  }

  // --- Generate / iterate ---
  state.turnCount++;

  // On first turn, build the system prompt + initial context
  if (state.messages.length === 0) {
    // Load existing flows as context
    const existingFlows = readYamlFiles(FLOW_DIR);
    let contextBlock = '';
    if (existingFlows.length > 0) {
      contextBlock = '\n\nEXISTING FLOWS IN THIS PROJECT (for style reference):\n\n';
      for (const f of existingFlows.slice(0, 6)) {
        contextBlock += '--- ' + f.name + ' ---\n' + f.content + '\n\n';
      }
    }

    const systemMsg =
      'You are an expert Maestro mobile test automation engineer. Generate valid Maestro YAML flow files.\n\n' +
      MAESTRO_SCHEMA + '\n\n' +
      'PROJECT CONVENTIONS:\n' +
      '1. Start with a comment describing the test\n' +
      '2. appId: ${APP_ID:-com.example.app}\n' +
      '3. Start commands with - launchApp\n' +
      '4. End with: - runFlow: ".maestro/flows/common/assert-no-crash-dialog.yaml"\n' +
      '5. Use ${ENV_VAR:-default} for dynamic values\n' +
      '6. Reuse common/ subflows\n' +
      '7. Use optional: true for elements that might not be present\n' +
      '8. One scenario per file, descriptive kebab-case filename\n\n' +
      'You are in interactive mode. The user may ask you to generate a new flow or refine an existing one.\n' +
      'Always output ONLY valid YAML. No markdown fences, no explanations.\n' +
      'If the user asks a question, answer briefly in plain text.\n' +
      contextBlock;

    state.messages.unshift({ role: 'system', content: systemMsg });
  }

  // Add user message
  state.messages.push({ role: 'user', content: input });

  console.log('🤖 Thinking...');
  try {
    const raw = await callLLM(config, state.messages);
    const yaml = extractYaml(raw);

    // Store assistant response
    state.messages.push({ role: 'assistant', content: raw });
    state.lastYaml = yaml;

    if (state.verbose) {
      console.log('─── LLM Response ───');
      console.log(raw);
      console.log('─── End ───\n');
    }

    // Display
    console.log('\n─── Generated YAML ───\n');
    console.log(yaml);
    console.log('\n─── End ───\n');

    if (!state.editingFlow) {
      // Auto-save for new flows
      const cat = state.category || inferCategory(input);
      const slug = slugify(input) || 'flow-' + Date.now().toString(36);
      const autoPath = join(FLOW_DIR, cat, slug + '.yaml');
      state.lastPath = autoPath.replace(PROJECT_ROOT + '/', '');

      if (!state.dryRun) {
        if (!existsSync(dirname(autoPath))) {
          mkdirSync(dirname(autoPath), { recursive: true });
        }
        writeFileSync(autoPath, yaml + '\n', 'utf8');
        console.log('💾 Auto-saved to: ' + state.lastPath);
        console.log('   (use @dry to preview, @save <path> to save elsewhere, @edit to refine)\n');
      } else {
        console.log('💡 Would save to: ' + state.lastPath + ' (dry-run mode)\n');
      }
    } else {
      console.log('💡 Use @save to write changes to ' + state.editingFlow.replace(PROJECT_ROOT + '/', '') + '\n');
    }
  } catch (err) {
    console.error('\n❌ Error: ' + err.message + '\n');
    // Remove failed user message from history
    state.messages.pop();
  }

  prompt();
}

// --- Startup ---
console.log('\n🤖 Maestro AI — Interactive Flow Generator');
console.log('   Provider: ' + config.AI_PROVIDER + ' | Model: ' + config.AI_MODEL);
console.log('   Type a test description to generate, or @help for commands.\n');

rl.on('line', handleInput);
rl.on('close', () => {
  console.log('\n👋 Goodbye!\n');
  process.exit(0);
});

prompt();
