import fs from 'fs/promises';
import path from 'path';
import jsYaml from 'js-yaml';
import { Persona, PersonaStats } from '../client/types/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BudgetCap {
  perTask?: number;
  perDay?: number;
}

export interface InvocationConfig {
  /** List of persona IDs this persona can invoke */
  allow?: string[];
  /** If true, can invoke any persona */
  allowAll?: boolean;
  /** Maximum concurrent invocations */
  maxConcurrent?: number;
}

export interface PersonaYamlSchema {
  /** Unique identifier – derived from filename if omitted */
  id?: string;
  /** Display name (required) */
  name: string;
  /** Single emoji character (required) */
  emoji: string;
  /** Short description 10-200 chars (required) */
  description: string;
  /** System prompt, min 50 chars (required) */
  prompt: string;
  /** Expertise areas, min 1 item (required) */
  specialties: string[];
  /** Trigger event types (optional) */
  triggers?: string[];
  /** Allowed provider names – security boundary (optional) */
  providers?: string[];
  /** Preferred AI model (optional) */
  model?: string;
  /** Token budget caps (optional) */
  budgetCap?: BudgetCap;
  /** Capabilities this persona can perform (optional) */
  skills?: string[];
  /** Invocation permissions – which personas this one can call (optional) */
  invocations?: InvocationConfig;
}

// Valid values according to the schema docs
const VALID_TRIGGERS = new Set([
  'pr_opened', 'pr_merged', 'pr_closed',
  'ticket_moved', 'test_failed', 'test_passed',
  'mentioned', 'scheduled',
]);

const VALID_SKILLS = new Set([
  'code', 'review', 'comment', 'docs', 'test',
]);
const PERSONA_ID_PATTERN = /^[a-z0-9-]+$/;

// ── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePersonaYaml(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, errors: ['Root value must be an object'], warnings };
  }

  const d = data as Record<string, unknown>;

  // ── Required fields ──────────────────────────────────────────────────────
  if (!d.name) {
    errors.push('Missing required field: name');
  } else if (typeof d.name !== 'string') {
    errors.push('Field "name" must be a string');
  } else if (d.name.length < 1 || d.name.length > 50) {
    errors.push('Field "name" must be 1-50 characters');
  }

  if (!d.emoji) {
    errors.push('Missing required field: emoji');
  } else if (typeof d.emoji !== 'string') {
    errors.push('Field "emoji" must be a string');
  }

  if (!d.description) {
    errors.push('Missing required field: description');
  } else if (typeof d.description !== 'string') {
    errors.push('Field "description" must be a string');
  } else if (d.description.length < 10 || d.description.length > 200) {
    errors.push('Field "description" must be 10-200 characters');
  }

  if (!d.prompt) {
    errors.push('Missing required field: prompt');
  } else if (typeof d.prompt !== 'string') {
    errors.push('Field "prompt" must be a string');
  } else if (d.prompt.length < 50) {
    errors.push('Field "prompt" must be at least 50 characters');
  }

  if (!d.specialties) {
    errors.push('Missing required field: specialties');
  } else if (!Array.isArray(d.specialties)) {
    errors.push('Field "specialties" must be an array');
  } else if (d.specialties.length < 1) {
    errors.push('Field "specialties" must have at least 1 item');
  } else if (!d.specialties.every((s) => typeof s === 'string')) {
    errors.push('Field "specialties" must be an array of strings');
  }

  // ── Optional field validation ─────────────────────────────────────────────
  if (d.id !== undefined) {
    if (typeof d.id !== 'string') {
      errors.push('Field "id" must be a string');
    } else if (!/^[a-z0-9-]+$/.test(d.id)) {
      errors.push('Field "id" must be lowercase-with-hyphens format');
    }
  }

  if (d.triggers !== undefined) {
    if (!Array.isArray(d.triggers)) {
      errors.push('Field "triggers" must be an array');
    } else {
      d.triggers.forEach((t) => {
        if (typeof t !== 'string') {
          errors.push(`Trigger value must be a string, got: ${typeof t}`);
        } else if (!VALID_TRIGGERS.has(t)) {
          warnings.push(`Unknown trigger type: "${t}" (will be ignored)`);
        }
      });
    }
  }

  if (d.providers !== undefined) {
    if (!Array.isArray(d.providers)) {
      errors.push('Field "providers" must be an array');
    } else if (!d.providers.every((p) => typeof p === 'string')) {
      errors.push('Field "providers" must be an array of strings');
    }
  }

  if (d.model !== undefined && typeof d.model !== 'string') {
    errors.push('Field "model" must be a string');
  }

  if (d.budgetCap !== undefined) {
    // Guard null explicitly before validating nested keys.
    if (d.budgetCap === null || typeof d.budgetCap !== 'object' || Array.isArray(d.budgetCap)) {
      errors.push('Field "budgetCap" must be an object');
    } else {
      const bc = d.budgetCap as Record<string, unknown>;
      if (bc.perTask !== undefined && typeof bc.perTask !== 'number') {
        errors.push('Field "budgetCap.perTask" must be a number');
      }
      if (bc.perDay !== undefined && typeof bc.perDay !== 'number') {
        errors.push('Field "budgetCap.perDay" must be a number');
      }
    }
  }

  if (d.skills !== undefined) {
    if (!Array.isArray(d.skills)) {
      errors.push('Field "skills" must be an array');
    } else {
      d.skills.forEach((s) => {
        if (typeof s !== 'string') {
          errors.push(`Skill value must be a string, got: ${typeof s}`);
        } else if (!VALID_SKILLS.has(s)) {
          warnings.push(`Unknown skill type: "${s}" (will be ignored)`);
        }
      });
    }
  }

  if (d.invocations !== undefined) {
    if (d.invocations === null || typeof d.invocations !== 'object' || Array.isArray(d.invocations)) {
      errors.push('Field "invocations" must be an object');
    } else {
      const inv = d.invocations as Record<string, unknown>;
      
      if (inv.allow !== undefined) {
        if (!Array.isArray(inv.allow)) {
          errors.push('Field "invocations.allow" must be an array');
        } else if (!inv.allow.every((p) => typeof p === 'string')) {
          errors.push('Field "invocations.allow" must be an array of strings');
        }
      }
      
      if (inv.allowAll !== undefined && typeof inv.allowAll !== 'boolean') {
        errors.push('Field "invocations.allowAll" must be a boolean');
      }
      
      if (inv.maxConcurrent !== undefined && typeof inv.maxConcurrent !== 'number') {
        errors.push('Field "invocations.maxConcurrent" must be a number');
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * Derive a persona id from a filename, e.g. "senior-developer.yaml" → "senior-developer"
 * Sanitizes to lowercase with hyphens: "My_Persona.yaml" → "my-persona"
 */
function idFromFilename(filename: string): string {
  return path
    .basename(filename)
    .replace(/\.(yaml|yml)$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildDefaultStats(): PersonaStats {
  return {
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
  };
}

/**
 * Convert a validated PersonaYamlSchema + filename into a Persona object.
 */
function yamlToPersona(yaml: PersonaYamlSchema, filename: string): Persona {
  const id = yaml.id ?? idFromFilename(filename);
  if (!PERSONA_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid persona id "${id}" in ${filename}. IDs must use lowercase letters, numbers, and hyphens.`,
    );
  }
  const now = new Date();
  const persona: any = {
    id,
    name: yaml.name,
    emoji: yaml.emoji,
    description: yaml.description,
    prompt: yaml.prompt,
    specialties: yaml.specialties,
    model: yaml.model,
    triggers: yaml.triggers,
    providers: yaml.providers,
    skills: yaml.skills,
    budgetCap: yaml.budgetCap,
    stats: buildDefaultStats(),
    createdAt: now,
    updatedAt: now,
  };
  
  // Include invocations if present
  if (yaml.invocations) {
    persona.invocations = yaml.invocations;
  }
  
  return persona;
}

/**
 * Scan `dirPath` for *.yaml / *.yml files (excluding *.example files),
 * parse and validate each, and return an array of valid Persona objects.
 */
export async function loadPersonasFromDir(dirPath: string): Promise<Persona[]> {
  const personas: Persona[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`[persona-yaml-loader] Directory not found: ${dirPath} – skipping`);
      return personas;
    }
    throw err;
  }

  const yamlFiles = entries.filter(
    (f) => /\.(yaml|yml)$/.test(f) && !/\.example$/.test(f),
  );

  for (const filename of yamlFiles) {
    const filePath = path.join(dirPath, filename);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = jsYaml.load(raw);
      const result = validatePersonaYaml(parsed);

      if (result.warnings.length > 0) {
        result.warnings.forEach((w) =>
          console.warn(`[persona-yaml-loader] ${filename}: ${w}`),
        );
      }

      if (!result.valid) {
        result.errors.forEach((e) =>
          console.warn(`[persona-yaml-loader] Skipping ${filename}: ${e}`),
        );
        continue;
      }

      const persona = yamlToPersona(parsed as PersonaYamlSchema, filename);
      personas.push(persona);
      console.log(`[persona-yaml-loader] Loaded persona: ${persona.emoji} ${persona.name} (${persona.id})`);
    } catch (err) {
      console.warn(`[persona-yaml-loader] Failed to parse ${filename}:`, err);
    }
  }

  return personas;
}

// ── Provider Access Control ──────────────────────────────────────────────────

/**
 * Throw if `persona` has a providers allow-list that does NOT include `requestedProvider`.
 *
 * If the persona has no providers list (undefined/null), all providers are allowed (open access).
 * An explicitly-empty providers list denies all providers.
 */
export function enforceProviderAccess(
  persona: PersonaYamlSchema | Persona,
  requestedProvider: string,
): void {
  // Shared by YAML parsing and runtime task execution paths.
  const providers = (persona as PersonaYamlSchema).providers;
  if (providers === undefined || providers === null) {
    // No restriction – all providers allowed
    return;
  }
  if (providers.length === 0) {
    throw new Error(
      `Persona "${persona.name}" has an empty providers allow-list, so access to provider "${requestedProvider}" is denied.`,
    );
  }
  if (!providers.includes(requestedProvider)) {
    throw new Error(
      `Persona "${persona.name}" is not allowed to access provider "${requestedProvider}". ` +
        `Allowed providers: ${providers.join(', ')}`,
    );
  }
}
