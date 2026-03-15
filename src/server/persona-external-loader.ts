import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import dns from 'dns/promises';
import { Persona } from '../client/types/index.js';
import { 
  PersonaYamlSchema, 
  validatePersonaYaml, 
  ValidationResult
} from './persona-yaml-loader.js';
import { BUILTIN_TRIGGER_DEFAULTS } from './persona-constants.js';
import jsYaml from 'js-yaml';

// Directories from which persona YAML files may be loaded.
// Only paths that start with one of these prefixes are allowed.
const ALLOWED_PERSONA_DIRS: string[] = [
  path.join(os.homedir(), '.tix-kanban', 'personas'),
  path.join(os.homedir(), '.tix-kanban', 'external-personas'),
];

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExternalPersonaSource {
  /** URL or file path to the persona YAML */
  location: string;
  /** Type of source */
  type: 'url' | 'file';
  /** Optional cache duration in seconds (for URLs) */
  cacheDurationSeconds?: number;
  /** Optional authentication token for private URLs */
  authToken?: string;
}

export interface LoadedExternalPersona {
  persona: Persona;
  source: ExternalPersonaSource;
  loadedAt: Date;
  /** If cached, when the cache expires */
  cacheExpiresAt?: Date;
}

// ── Cache Management ─────────────────────────────────────────────────────────

interface PersonaCache {
  [location: string]: {
    data: string;
    loadedAt: Date;
    expiresAt: Date;
  };
}

const personaCache: PersonaCache = {};
const MAX_RESPONSE_BYTES = 1024 * 1024;

function isCacheValid(location: string): boolean {
  const cached = personaCache[location];
  if (!cached) return false;
  return new Date() < cached.expiresAt;
}

function getFromCache(location: string): string | null {
  if (!isCacheValid(location)) {
    delete personaCache[location];
    return null;
  }
  return personaCache[location].data;
}

function addToCache(
  location: string, 
  data: string, 
  durationSeconds: number = 3600
): void {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationSeconds * 1000);
  personaCache[location] = {
    data,
    loadedAt: now,
    expiresAt,
  };
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '::1' || normalized === '::') {
    return true;
  }

  // Block IPv6 private/special ranges.
  if (normalized.includes(':')) {
    if (normalized.startsWith('fe80')) return true;           // link-local
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique-local
    if (normalized.startsWith('::ffff:')) {
      // IPv4-mapped IPv6 — extract embedded IPv4 and re-check
      const embedded = normalized.slice(7);
      return isBlockedHostname(embedded);
    }
    return false;
  }

  // Block private/internal IPv4 ranges.
  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }

  const octets = ipv4Match.slice(1).map((octet) => Number.parseInt(octet, 10));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [a, b] = octets;
  if (a === 0) return true;                          // 0.0.0.0/8 — unspecified
  if (a === 127 || a === 10) return true;            // loopback + RFC-1918
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16 — link-local / cloud metadata (AWS IMDS, GCP, Azure)
  if (a === 192 && b === 168) return true;           // RFC-1918
  if (a === 172 && b >= 16 && b <= 31) return true;  // RFC-1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 — CGNAT / shared address space
  return false;
}

async function validateExternalUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Security: URL must use http or https: ${rawUrl}`);
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error(`Security: URL points to a blocked internal address: ${rawUrl}`);
  }

  // Resolve the hostname and re-check the resolved IP to prevent SSRF via
  // attacker-controlled domains that resolve to private/internal addresses.
  try {
    const { address } = await dns.lookup(parsed.hostname);
    if (isBlockedHostname(address)) {
      throw new Error(`Security: URL hostname resolves to a blocked internal address: ${rawUrl}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Security:')) throw err;
    throw new Error(`Security: Unable to resolve hostname for ${rawUrl}`);
  }

  return parsed;
}

// ── Loaders ──────────────────────────────────────────────────────────────────

/**
 * Load persona YAML from a URL
 */
async function loadFromUrl(
  url: string, 
  authToken?: string,
  cacheDurationSeconds: number = 3600
): Promise<string> {
  const parsedUrl = await validateExternalUrl(url);
  const cacheKey = parsedUrl.toString();

  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(`[persona-external-loader] Using cached version of ${cacheKey}`);
    return cached;
  }

  console.log(`[persona-external-loader] Fetching persona from ${cacheKey}`);
  
  const headers: Record<string, string> = {
    'Accept': 'application/x-yaml, text/yaml, text/plain',
  };
  
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let response: Response;
    try {
      response = await fetch(parsedUrl, { headers, signal: controller.signal, redirect: 'error' });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw new Error(`Response from ${cacheKey} exceeds 1MB limit`);
      }
    }

    const reader = response.body?.getReader();
    if (!reader) {
      addToCache(cacheKey, '', cacheDurationSeconds);
      return '';
    }

    const decoder = new TextDecoder();
    let totalBytes = 0;
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        controller.abort();
        throw new Error(`Response from ${cacheKey} exceeds 1MB limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();

    // Cache the result
    addToCache(cacheKey, text, cacheDurationSeconds);

    return text;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to fetch persona from ${url}: ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Load persona YAML from a local file path
 */
async function loadFromFile(filePath: string): Promise<string> {
  console.log(`[persona-external-loader] Loading persona from ${filePath}`);
  
  try {
    // Resolve to absolute path (handles relative paths)
    const absolutePath = path.resolve(filePath);

    // Resolve symlinks to prevent symlink bypass attacks — a symlink inside an
    // allowed directory could otherwise point outside it and bypass the check.
    let resolvedPath: string;
    try {
      resolvedPath = await fs.realpath(absolutePath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Persona file not found: ${filePath}`);
      }
      throw e;
    }

    // Security check: reject paths that fall outside the allowed directories.
    // This prevents an external-source configuration from being used to read
    // arbitrary files (e.g. /etc/passwd or private keys) from the host.
    const isAllowed = ALLOWED_PERSONA_DIRS.some(
      (dir) => resolvedPath === dir || resolvedPath.startsWith(dir + path.sep)
    );
    if (!isAllowed) {
      throw new Error(
        `Security: persona file path "${filePath}" is not within an allowed directory. ` +
        `Allowed directories: ${ALLOWED_PERSONA_DIRS.join(', ')}`
      );
    }

    const content = await fs.readFile(resolvedPath, 'utf8');
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Persona file not found: ${filePath}`);
    }
    throw new Error(
      `Failed to read persona file ${filePath}: ${(error as Error).message}`
    );
  }
}

/**
 * Parse YAML content into PersonaYamlSchema and validate
 */
function parseAndValidate(
  yamlContent: string, 
  source: string
): { schema: PersonaYamlSchema; validation: ValidationResult } {
  let parsed: unknown;
  
  try {
    parsed = jsYaml.load(yamlContent);
  } catch (error) {
    throw new Error(
      `Failed to parse YAML from ${source}: ${(error as Error).message}`
    );
  }

  const validation = validatePersonaYaml(parsed);
  
  if (!validation.valid) {
    throw new Error(
      `Invalid persona YAML from ${source}:\n` +
      validation.errors.join('\n')
    );
  }

  if (validation.warnings.length > 0) {
    validation.warnings.forEach(warning => 
      console.warn(`[persona-external-loader] ${source}: ${warning}`)
    );
  }

  return {
    schema: parsed as PersonaYamlSchema,
    validation,
  };
}

/**
 * Convert PersonaYamlSchema to Persona object
 */
function schemaToPersona(
  schema: PersonaYamlSchema, 
  sourceLocation: string
): Persona {
  // Derive ID from filename or use provided ID
  let id = schema.id;
  if (!id) {
    // Try to extract from URL or file path
    const basename = path.basename(sourceLocation, '.yaml')
      .replace(/\.yml$/, '');
    id = basename
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  const now = new Date();
  return {
    id,
    name: schema.name,
    emoji: schema.emoji,
    description: schema.description,
    prompt: schema.prompt,
    specialties: schema.specialties,
    model: schema.model,
    triggers: (() => {
      const builtins = BUILTIN_TRIGGER_DEFAULTS[id] || {};
      const merged = { ...builtins, ...(schema.triggers || {}) };
      return Object.keys(merged).length > 0 ? merged : undefined;
    })(),
    providers: schema.providers,
    skills: schema.skills,
    budgetCap: schema.budgetCap,
    stats: {
      tasksCompleted: 0,
      averageCompletionTime: 0,
      successRate: 0,
      ratings: {
        total: 0,
        good: 0,
        needsImprovement: 0,
        redo: 0,
        averageRating: 0,
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a persona from an external source (URL or file path)
 * 
 * @param source - The external source configuration
 * @returns Loaded persona with metadata
 * 
 * @example
 * ```typescript
 * // Load from URL
 * const result = await loadExternalPersona({
 *   location: 'https://example.com/personas/my-persona.yaml',
 *   type: 'url',
 *   cacheDurationSeconds: 3600,
 * });
 * 
 * // Load from file
 * const result = await loadExternalPersona({
 *   location: '/path/to/my-persona.yaml',
 *   type: 'file',
 * });
 * ```
 */
export async function loadExternalPersona(
  source: ExternalPersonaSource
): Promise<LoadedExternalPersona> {
  let yamlContent: string;
  
  // Load from appropriate source
  if (source.type === 'url') {
    yamlContent = await loadFromUrl(
      source.location, 
      source.authToken,
      source.cacheDurationSeconds
    );
  } else if (source.type === 'file') {
    yamlContent = await loadFromFile(source.location);
  } else {
    throw new Error(`Unsupported source type: ${(source as any).type}`);
  }

  // Parse and validate
  const { schema } = parseAndValidate(yamlContent, source.location);

  // Convert to Persona object
  const persona = schemaToPersona(schema, source.location);

  const loadedAt = new Date();
  const result: LoadedExternalPersona = {
    persona,
    source,
    loadedAt,
  };

  // Add cache expiry if URL with cache duration
  if (source.type === 'url' && source.cacheDurationSeconds) {
    result.cacheExpiresAt = new Date(
      loadedAt.getTime() + source.cacheDurationSeconds * 1000
    );
  }

  console.log(
    `[persona-external-loader] Successfully loaded external persona: ` +
    `${persona.emoji} ${persona.name} (${persona.id}) from ${source.location}`
  );

  return result;
}

/**
 * Load multiple personas from external sources
 * 
 * @param sources - Array of external source configurations
 * @returns Array of successfully loaded personas (failures are logged but not thrown)
 */
export interface LoadExternalPersonasResult {
  loaded: LoadedExternalPersona[];
  failed: Array<{ source: ExternalPersonaSource; error: string }>;
}

export async function loadExternalPersonas(
  sources: ExternalPersonaSource[]
): Promise<LoadExternalPersonasResult> {
  const loaded: LoadedExternalPersona[] = [];
  const failed: Array<{ source: ExternalPersonaSource; error: string }> = [];

  for (const source of sources) {
    try {
      const result = await loadExternalPersona(source);
      loaded.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[persona-external-loader] Failed to load persona from ${source.location}:`,
        error
      );
      failed.push({ source, error: message });
    }
  }

  return { loaded, failed };
}

/**
 * Clear the cache for a specific location or all locations
 */
export function clearPersonaCache(location?: string): void {
  if (location) {
    let normalizedLocation: string;
    try {
      normalizedLocation = new URL(location).toString();
    } catch {
      // Not a valid URL (e.g. file path) — check if the raw string is a cache key, else no-op.
      if (Object.prototype.hasOwnProperty.call(personaCache, location)) {
        delete personaCache[location];
        console.log(`[persona-external-loader] Cleared cache for ${location}`);
      } else {
        console.warn(`[persona-external-loader] clearPersonaCache: "${location}" is not a valid URL or known cache key — skipping`);
      }
      return;
    }
    delete personaCache[normalizedLocation];
    console.log(`[persona-external-loader] Cleared cache for ${normalizedLocation}`);
  } else {
    Object.keys(personaCache).forEach(key => delete personaCache[key]);
    console.log('[persona-external-loader] Cleared all persona cache');
  }
}

