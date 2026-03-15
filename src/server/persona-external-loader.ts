import axios from 'axios';
import crypto from 'crypto';
import { lookup } from 'dns/promises';
import fs from 'fs/promises';
import { isIP } from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { Persona } from '../client/types/index.js';
import { 
  PersonaYamlSchema, 
  validatePersonaYaml, 
  ValidationResult,
  yamlToPersona,
  idFromFilename
} from './persona-yaml-loader.js';
import jsYaml from 'js-yaml';

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

function hashAuthToken(authToken: string): string {
  return crypto.createHash('sha256').update(authToken).digest('hex').slice(0, 12);
}

function getPersonaCacheKey(url: string, authToken?: string): string {
  return authToken ? `${url}::token:${hashAuthToken(authToken)}` : url;
}

function isPrivateOrLoopbackIp(ipAddress: string): boolean {
  const normalized = ipAddress.toLowerCase();
  const mappedIpv4Match = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4Match) {
    return isPrivateOrLoopbackIp(mappedIpv4Match[1]);
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const parts = normalized.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (ipVersion === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  }

  return true;
}

async function validateExternalUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw new Error(`Invalid URL "${url}": ${(e as Error).message}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Security violation: only HTTPS URLs are allowed (got "${parsed.protocol}")`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost') {
    throw new Error(`Security violation: requests to internal addresses are not allowed (${hostname})`);
  }

  if (isIP(hostname) !== 0) {
    if (isPrivateOrLoopbackIp(hostname)) {
      throw new Error(`Security violation: requests to internal addresses are not allowed (${hostname})`);
    }
    return;
  }

  let resolvedAddresses: Array<{ address: string }>;
  try {
    resolvedAddresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (e) {
    throw new Error(`Invalid URL "${url}": unable to resolve hostname "${hostname}" (${(e as Error).message})`);
  }

  if (resolvedAddresses.length === 0) {
    throw new Error(`Invalid URL "${url}": hostname "${hostname}" did not resolve to an address`);
  }

  for (const resolved of resolvedAddresses) {
    if (isPrivateOrLoopbackIp(resolved.address)) {
      throw new Error(
        `Security violation: hostname "${hostname}" resolves to internal address "${resolved.address}"`
      );
    }
  }
}

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
  // SSRF protection: validate URL BEFORE cache lookup to prevent bypass.
  await validateExternalUrl(url);

  // Check cache after SSRF validation.
  // Include a hash of authToken in the cache key so requests with different
  // credentials don't share cache entries.
  const cacheKey = getPersonaCacheKey(url, authToken);
  const cached = getFromCache(cacheKey);
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

    // Cache the result under the token-aware key
    addToCache(cacheKey, data, cacheDurationSeconds);

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
  path.resolve(process.cwd(), 'personas'),
  path.resolve(process.cwd(), 'personas/builtin'),
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
  // Ensure ID is set - derive from sourceLocation if not provided.
  // For URL sources, strip query params before extracting the basename so that
  // e.g. "https://example.com/persona.yaml?v=2" yields "persona" not "persona-yaml-v-2".
  if (!schema.id) {
    let locationForId = sourceLocation;
    try {
      const parsed = new URL(sourceLocation);
      // Use only origin + pathname — drop search/hash
      locationForId = parsed.origin + parsed.pathname;
    } catch {
      // Not a URL (local file path) — use as-is
    }
    schema.id = idFromFilename(locationForId);
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
export function clearPersonaCache(location?: string, authToken?: string): void {
  if (location) {
    const keysToDelete = authToken
      ? [getPersonaCacheKey(location, authToken)]
      : Object.keys(personaCache).filter(key => key === location || key.startsWith(`${location}::token:`));
    keysToDelete.forEach(key => delete personaCache[key]);
    console.log(`[persona-external-loader] Cleared cache for ${location}${authToken ? ' (token-specific)' : ''}`);
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
  clearPersonaCache(source.location, source.authToken);
  return loadExternalPersona(source);
}
