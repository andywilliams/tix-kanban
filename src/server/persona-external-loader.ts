import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Persona } from '../client/types/index.js';
import { 
  PersonaYamlSchema, 
  validatePersonaYaml, 
  ValidationResult,
  yamlToPersona,
  idFromFilename
} from './persona-yaml-loader.js';
import jsYaml from 'js-yaml';

// ESM __dirname polyfill
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// ── Loaders ──────────────────────────────────────────────────────────────────

/**
 * Load persona YAML from a URL
 */
async function loadFromUrl(
  url: string, 
  authToken?: string,
  cacheDurationSeconds: number = 3600
): Promise<string> {
  // SSRF protection: validate URL BEFORE cache lookup to prevent bypass
  // Only allow https:// URLs; reject private/loopback addresses
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error(`Security violation: only HTTPS URLs are allowed (got "${parsed.protocol}")`);
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    // Block loopback, private RFC-1918 ranges, link-local, and IPv4-mapped IPv6 addresses
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||           // 127.0.0.0/8 loopback range
      hostname === '::' ||                       // IPv6 all-zeros (equivalent to 0.0.0.0)
      hostname === '0.0.0.0' ||               // Linux resolves to localhost
      hostname === '::1' ||                   // IPv6 loopback
      hostname.startsWith('::ffff:127.') ||   // IPv4-mapped IPv6 loopback
      hostname.startsWith('::ffff:0.0.0.0') || // IPv4-mapped IPv6 0.0.0.0
      hostname.startsWith('169.254.') ||      // IPv4 link-local
      hostname.startsWith('10.') ||           // RFC-1918
      hostname.startsWith('192.168.') ||      // RFC-1918
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)    // RFC-1918 172.16–31
    ) {
      throw new Error(`Security violation: requests to internal addresses are not allowed (${hostname})`);
    }
    // Additional IPv6-specific checks (only apply to IPv6 addresses containing colons)
    const isIPv6 = hostname.includes(':');
    if (isIPv6) {
      if (hostname.startsWith('fc') || hostname.startsWith('fd')) {
        throw new Error('Security violation: IPv6 unique-local addresses blocked');
      }
      if (hostname.startsWith('fe80')) {
        throw new Error('Security violation: IPv6 link-local addresses blocked');
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Security violation')) throw e;
    throw new Error(`Invalid URL "${url}": ${(e as Error).message}`);
  }

  // Check cache after SSRF validation
  const cached = getFromCache(url);
  if (cached) {
    console.log(`[persona-external-loader] Using cached version of ${url}`);
    return cached;
  }

  console.log(`[persona-external-loader] Fetching persona from ${url}`);
  
  const headers: Record<string, string> = {
    'Accept': 'application/x-yaml, text/yaml, text/plain',
  };
  
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const response = await axios.get(url, {
      headers,
      // Use responseType 'text' to prevent axios from auto-parsing YAML as JSON
      responseType: 'text',
      timeout: 10000, // 10 second timeout
      maxContentLength: 1024 * 1024, // 1MB max
      maxRedirects: 0, // Prevent SSRF bypass via HTTP redirect chains
    });

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: string = response.data;

    // Cache the result
    addToCache(url, data, cacheDurationSeconds);

    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to fetch persona from ${url}: ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Allowed base directories for local persona file loading.
 * Files must resolve to one of these directories to prevent path traversal attacks.
 */
const ALLOWED_PERSONA_DIRS: string[] = [
  path.resolve(__dirname, '../../personas'),
  path.resolve(__dirname, '../../personas/builtin'),
];

/**
 * Load persona YAML from a local file path
 */
async function loadFromFile(filePath: string): Promise<string> {
  console.log(`[persona-external-loader] Loading persona from ${filePath}`);
  
  try {
    // Resolve to absolute path
    const absolutePath = path.resolve(filePath);
    
    // Security check: prevent path traversal attacks (e.g. ../../etc/passwd).
    // Ensure the resolved path is within one of the allowed base directories.
    const isAllowed = ALLOWED_PERSONA_DIRS.some(
      allowedDir =>
        absolutePath.startsWith(allowedDir + path.sep) ||
        absolutePath === allowedDir
    );

    if (!isAllowed) {
      throw new Error(
        `Security violation: path "${filePath}" resolves to "${absolutePath}" ` +
        `which is outside the allowed directories: ${ALLOWED_PERSONA_DIRS.join(', ')}`
      );
    }

    const content = await fs.readFile(absolutePath, 'utf8');
    return content;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Security violation')) {
      throw error;
    }
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
 * Convert PersonaYamlSchema to Persona object using shared helper
 */
function schemaToPersona(
  schema: PersonaYamlSchema, 
  sourceLocation: string
): Persona {
  // Ensure ID is set - derive from sourceLocation if not provided
  if (!schema.id) {
    schema.id = idFromFilename(sourceLocation);
  }

  // Use shared conversion function - passing undefined for filename since ID is set
  return yamlToPersona(schema);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a persona from an external source (URL or file path)
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
 * NOTE: This is a Phase 4 API entry point - currently unused but reserved for
 * future wiring into startup/worker flows for bulk loading external personas.
 */
export async function loadExternalPersonas(
  sources: ExternalPersonaSource[]
): Promise<LoadedExternalPersona[]> {
  const results: LoadedExternalPersona[] = [];

  for (const source of sources) {
    try {
      const result = await loadExternalPersona(source);
      results.push(result);
    } catch (error) {
      console.error(
        `[persona-external-loader] Failed to load persona from ${source.location}:`,
        error
      );
      // Continue with other sources instead of failing completely
    }
  }

  return results;
}

/**
 * Clear the cache for a specific location or all locations
 */
export function clearPersonaCache(location?: string): void {
  if (location) {
    delete personaCache[location];
    console.log(`[persona-external-loader] Cleared cache for ${location}`);
  } else {
    Object.keys(personaCache).forEach(key => delete personaCache[key]);
    console.log('[persona-external-loader] Cleared all persona cache');
  }
}

/**
 * Refresh a cached persona (force re-fetch)
 */
export async function refreshExternalPersona(
  source: ExternalPersonaSource
): Promise<LoadedExternalPersona> {
  clearPersonaCache(source.location);
  return loadExternalPersona(source);
}
