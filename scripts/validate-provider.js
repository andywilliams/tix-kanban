#!/usr/bin/env node
/**
 * Forge Provider Validator
 * 
 * Validates that a CLI provider conforms to the Forge Provider Specification.
 * 
 * Usage:
 *   ./scripts/validate-provider.js --type ticket --command "tix sync --json"
 *   ./scripts/validate-provider.js --type message --command "slx sync --json" --env SLACK_TOKEN=xyz
 */

import { spawn } from 'child_process';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, 'green');
}

function error(message) {
  log(`✗ ${message}`, 'red');
}

function warning(message) {
  log(`⚠ ${message}`, 'yellow');
}

function info(message) {
  log(`ℹ ${message}`, 'blue');
}

// Schema validators
const schemas = {
  ticket: {
    required: ['id', 'title', 'status'],
    optional: ['ticketNumber', 'priority', 'assignee', 'labels', 'url', 'githubLinks', 'lastUpdated'],
    validate: (item) => {
      if (typeof item.id !== 'string') return 'id must be a string';
      if (typeof item.title !== 'string') return 'title must be a string';
      if (typeof item.status !== 'string') return 'status must be a string';
      if (item.labels && !Array.isArray(item.labels)) return 'labels must be an array';
      if (item.githubLinks && !Array.isArray(item.githubLinks)) return 'githubLinks must be an array';
      if (item.lastUpdated && !isValidISO8601(item.lastUpdated)) return 'lastUpdated must be ISO 8601';
      return null;
    }
  },
  message: {
    required: ['id', 'channel', 'author', 'text', 'timestamp'],
    optional: ['channelId', 'threadTs', 'replies', 'reactions', 'url'],
    validate: (item) => {
      if (typeof item.id !== 'string') return 'id must be a string';
      if (typeof item.channel !== 'string') return 'channel must be a string';
      if (typeof item.author !== 'string') return 'author must be a string';
      if (typeof item.text !== 'string') return 'text must be a string';
      if (typeof item.timestamp !== 'string') return 'timestamp must be a string';
      if (!isValidISO8601(item.timestamp)) return 'timestamp must be ISO 8601';
      if (item.replies && !Array.isArray(item.replies)) return 'replies must be an array';
      if (item.reactions && !Array.isArray(item.reactions)) return 'reactions must be an array';
      return null;
    }
  },
  'test-result': {
    required: ['id', 'suite', 'runAt', 'passed', 'failed', 'total', 'status'],
    optional: ['ticketId', 'failures'],
    validate: (item) => {
      if (typeof item.id !== 'string') return 'id must be a string';
      if (typeof item.suite !== 'string') return 'suite must be a string';
      if (typeof item.runAt !== 'string') return 'runAt must be a string';
      if (!isValidISO8601(item.runAt)) return 'runAt must be ISO 8601';
      if (typeof item.passed !== 'number') return 'passed must be a number';
      if (typeof item.failed !== 'number') return 'failed must be a number';
      if (typeof item.total !== 'number') return 'total must be a number';
      if (!['passing', 'failing'].includes(item.status)) return 'status must be "passing" or "failing"';
      if (item.failures && !Array.isArray(item.failures)) return 'failures must be an array';
      return null;
    }
  }
};

function isValidISO8601(dateString) {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date) && date.toISOString() === dateString;
}

async function runProvider(command, envVars = {}) {
  return new Promise((resolve, reject) => {
    const parts = command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    let stdout = '';
    let stderr = '';

    const child = spawn(cmd, args, {
      env: { ...process.env, ...envVars },
      shell: true,
    });

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on('error', (err) => {
      reject(err);
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
      reject(new Error('Provider timeout (30s)'));
    }, 30000);
  });
}

async function validateProvider(type, command, envVars = {}, dryRun = false) {
  info(`Validating ${type} provider: ${command}\n`);

  const schema = schemas[type];
  if (!schema) {
    error(`Unknown provider type: ${type}`);
    error(`Valid types: ${Object.keys(schemas).join(', ')}`);
    process.exit(1);
  }

  // Step 1: Check if provider is executable
  info('Step 1: Checking if provider is executable...');
  try {
    const { code, stdout, stderr } = await runProvider(command, envVars);

    // Step 2: Validate exit code
    info('Step 2: Validating exit code...');
    if (code === 0) {
      success('Exit code 0 (success)');
    } else if (code === 1) {
      warning(`Exit code 1 (general error)`);
      if (stderr) {
        console.log('stderr:', stderr);
      }
    } else if (code === 2) {
      warning(`Exit code 2 (auth failure)`);
      if (stderr) {
        console.log('stderr:', stderr);
      }
    } else if (code === 3) {
      warning(`Exit code 3 (timeout)`);
    } else {
      error(`Unexpected exit code: ${code}`);
    }

    // Step 3: Validate JSON output
    info('Step 3: Validating JSON output...');
    let data;
    try {
      data = JSON.parse(stdout);
      success('Valid JSON output');
    } catch (e) {
      error('stdout is not valid JSON');
      console.log('stdout:', stdout.slice(0, 500));
      process.exit(1);
    }

    // Step 4: Validate array format
    info('Step 4: Validating array format...');
    if (!Array.isArray(data)) {
      error('Output is not a JSON array');
      process.exit(1);
    }
    success(`Output is an array with ${data.length} item(s)`);

    if (data.length === 0) {
      warning('Empty array returned - cannot validate schema');
      info('\n✓ Provider validation complete (empty result set)');
      return;
    }

    // Step 5: Validate schema for each item
    info(`Step 5: Validating schema for ${data.length} item(s)...`);
    let validCount = 0;
    let errorCount = 0;

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const itemLabel = `Item ${i + 1}`;

      // Check required fields
      const missingFields = schema.required.filter(field => !(field in item));
      if (missingFields.length > 0) {
        error(`${itemLabel}: Missing required fields: ${missingFields.join(', ')}`);
        errorCount++;
        continue;
      }

      // Check field types
      const validationError = schema.validate(item);
      if (validationError) {
        error(`${itemLabel}: ${validationError}`);
        errorCount++;
        continue;
      }

      validCount++;
    }

    if (validCount === data.length) {
      success(`All ${validCount} items valid`);
    } else {
      warning(`${validCount} valid, ${errorCount} invalid`);
    }

    // Step 6: Check for error format on stderr
    if (stderr) {
      info('Step 6: Checking stderr error format...');
      try {
        const errorObj = JSON.parse(stderr);
        if (errorObj.error && typeof errorObj.error === 'string') {
          success('stderr contains valid JSON error object');
        } else {
          warning('stderr is JSON but missing required "error" field');
        }
      } catch (e) {
        warning('stderr is not JSON (plain text error message)');
        console.log('stderr:', stderr.slice(0, 200));
      }
    }

    // Summary
    console.log();
    if (code === 0 && validCount === data.length) {
      success('✓ Provider validation PASSED');
      process.exit(0);
    } else {
      warning('⚠ Provider validation completed with warnings');
      process.exit(0);
    }

  } catch (err) {
    error(`Provider execution failed: ${err.message}`);
    process.exit(1);
  }
}

// CLI argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    type: null,
    command: null,
    env: {},
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--type' && i + 1 < args.length) {
      config.type = args[++i];
    } else if (arg === '--command' && i + 1 < args.length) {
      config.command = args[++i];
    } else if (arg === '--env' && i + 1 < args.length) {
      const envPair = args[++i];
      const [key, value] = envPair.split('=');
      if (key && value) {
        config.env[key] = value;
      }
    } else if (arg === '--dry-run') {
      config.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Forge Provider Validator

Usage:
  validate-provider.js --type <type> --command "<command>" [options]

Options:
  --type <type>        Provider type (ticket, message, test-result)
  --command "<cmd>"    Full command to execute (in quotes)
  --env KEY=VALUE      Environment variable (repeatable)
  --dry-run            Show what would be validated without executing
  --help, -h           Show this help

Examples:
  validate-provider.js --type ticket --command "tix sync --json"
  validate-provider.js --type message --command "slx sync --json" --env SLACK_TOKEN=xyz
  validate-provider.js --type test-result --command "npm run test:api -- --json"
      `);
      process.exit(0);
    }
  }

  if (!config.type || !config.command) {
    error('Missing required arguments: --type and --command');
    console.log('Run with --help for usage information');
    process.exit(1);
  }

  return config;
}

// Main
const config = parseArgs();
validateProvider(config.type, config.command, config.env, config.dryRun);
