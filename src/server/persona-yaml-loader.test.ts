import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  validatePersonaYaml,
  loadPersonasFromDir,
  enforceProviderAccess,
  type PersonaYamlSchema,
} from './persona-yaml-loader.js';

// ── validatePersonaYaml ───────────────────────────────────────────────────────

describe('validatePersonaYaml', () => {
  const validBase: PersonaYamlSchema = {
    name: 'Test Persona',
    emoji: '🤖',
    description: 'A valid test persona with sufficient description length.',
    prompt: 'You are a test persona. This prompt is long enough to pass validation checks.',
    specialties: ['testing', 'validation'],
  };

  it('accepts a fully valid persona', () => {
    const result = validatePersonaYaml(validBase);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null input', () => {
    const result = validatePersonaYaml(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Root value must be an object/);
  });

  it('rejects array input', () => {
    const result = validatePersonaYaml([validBase]);
    expect(result.valid).toBe(false);
  });

  it('rejects missing name', () => {
    const { name: _name, ...rest } = validBase;
    const result = validatePersonaYaml(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: name');
  });

  it('rejects missing emoji', () => {
    const { emoji: _emoji, ...rest } = validBase;
    const result = validatePersonaYaml(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: emoji');
  });

  it('rejects missing description', () => {
    const { description: _desc, ...rest } = validBase;
    const result = validatePersonaYaml(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: description');
  });

  it('rejects description that is too short', () => {
    const result = validatePersonaYaml({ ...validBase, description: 'Too short' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('description'))).toBe(true);
  });

  it('rejects missing prompt', () => {
    const { prompt: _prompt, ...rest } = validBase;
    const result = validatePersonaYaml(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: prompt');
  });

  it('rejects prompt that is too short', () => {
    const result = validatePersonaYaml({ ...validBase, prompt: 'Too short.' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('prompt'))).toBe(true);
  });

  it('rejects missing specialties', () => {
    const { specialties: _specialties, ...rest } = validBase;
    const result = validatePersonaYaml(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: specialties');
  });

  it('rejects empty specialties array', () => {
    const result = validatePersonaYaml({ ...validBase, specialties: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid id format', () => {
    const result = validatePersonaYaml({ ...validBase, id: 'Not Valid ID!' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('id'))).toBe(true);
  });

  it('accepts valid optional id', () => {
    const result = validatePersonaYaml({ ...validBase, id: 'my-persona-123' });
    expect(result.valid).toBe(true);
  });

  it('warns on unknown trigger keys', () => {
    const result = validatePersonaYaml({
      ...validBase,
      triggers: {
        onPROpened: true,
        unknownTrigger: true,
      } as unknown as PersonaYamlSchema['triggers'],
    });
    expect(result.valid).toBe(true); // warnings don't fail validation
    expect(result.warnings.some((w) => w.includes('unknownTrigger'))).toBe(true);
  });

  it('accepts valid triggers', () => {
    const result = validatePersonaYaml({
      ...validBase,
      triggers: {
        onPROpened: true,
        onPRMerged: false,
        onCIPassed: true,
      },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns on unknown skill types', () => {
    const result = validatePersonaYaml({ ...validBase, skills: ['code', 'telepathy'] });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('telepathy'))).toBe(true);
  });

  it('validates budgetCap fields', () => {
    const result = validatePersonaYaml({
      ...validBase,
      budgetCap: { perTask: 'not-a-number' as unknown as number },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('budgetCap.perTask'))).toBe(true);
  });

  it('accepts valid budgetCap', () => {
    const result = validatePersonaYaml({
      ...validBase,
      budgetCap: { perTask: 100000, perDay: 500000 },
    });
    expect(result.valid).toBe(true);
  });
});

// ── loadPersonasFromDir ───────────────────────────────────────────────────────

describe('loadPersonasFromDir', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-loader-test-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array for non-existent directory', async () => {
    const personas = await loadPersonasFromDir('/non/existent/path');
    expect(personas).toEqual([]);
  });

  it('loads a valid YAML file', async () => {
    const yaml = `
name: Test Bot
emoji: "🤖"
description: A test persona used only in automated tests.
specialties:
  - testing
prompt: |
  You are a test persona. This prompt is long enough to satisfy the minimum
  character requirement for prompt validation in the persona YAML schema.
`;
    await fs.writeFile(path.join(tmpDir, 'test-bot.yaml'), yaml, 'utf8');
    const personas = await loadPersonasFromDir(tmpDir);
    expect(personas.length).toBeGreaterThanOrEqual(1);
    const p = personas.find((x) => x.id === 'test-bot');
    expect(p).toBeDefined();
    expect(p?.name).toBe('Test Bot');
    expect(p?.emoji).toBe('🤖');
  });

  it('skips .example files', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'example-persona.yaml.example'),
      'name: Should Be Skipped\nemoji: ❌\ndescription: skip\nprompt: skip\nspecialties: []\n',
      'utf8',
    );
    const personas = await loadPersonasFromDir(tmpDir);
    expect(personas.find((p) => p.name === 'Should Be Skipped')).toBeUndefined();
  });

  it('skips invalid YAML files without throwing', async () => {
    await fs.writeFile(path.join(tmpDir, 'invalid.yaml'), '{ invalid yaml: [', 'utf8');
    // Should not throw
    const personas = await loadPersonasFromDir(tmpDir);
    expect(Array.isArray(personas)).toBe(true);
  });

  it('skips files with missing required fields', async () => {
    const yaml = `name: Incomplete\nemoji: "❓"`;
    await fs.writeFile(path.join(tmpDir, 'incomplete.yaml'), yaml, 'utf8');
    const personas = await loadPersonasFromDir(tmpDir);
    expect(personas.find((p) => p.name === 'Incomplete')).toBeUndefined();
  });

  it('derives id from filename when id is not set', async () => {
    const yaml = `
name: Derived ID Persona
emoji: "🆔"
description: Tests that id is derived from the filename automatically.
specialties:
  - id-derivation
prompt: |
  You are a persona whose id is derived from the filename.
  This prompt meets the minimum length requirement for validation.
`;
    await fs.writeFile(path.join(tmpDir, 'derived-id-persona.yaml'), yaml, 'utf8');
    const personas = await loadPersonasFromDir(tmpDir);
    const p = personas.find((x) => x.id === 'derived-id-persona');
    expect(p).toBeDefined();
  });

  it('uses explicit id from YAML when provided', async () => {
    const yaml = `
id: explicit-id
name: Explicit ID Persona
emoji: "✅"
description: Tests that an explicit id in YAML is respected by the loader.
specialties:
  - explicit-id
prompt: |
  You are a persona with an explicitly-defined id field in the YAML file.
  This prompt is long enough to pass the minimum length validation check.
`;
    await fs.writeFile(path.join(tmpDir, 'some-other-name.yaml'), yaml, 'utf8');
    const personas = await loadPersonasFromDir(tmpDir);
    const p = personas.find((x) => x.id === 'explicit-id');
    expect(p).toBeDefined();
  });
});

// ── enforceProviderAccess ─────────────────────────────────────────────────────

describe('enforceProviderAccess', () => {
  const baseYaml: PersonaYamlSchema = {
    name: 'Restricted Persona',
    emoji: '🔐',
    description: 'A persona with restricted provider access for testing.',
    prompt: 'You are a restricted persona used only in automated tests for provider access control.',
    specialties: ['security'],
    providers: ['github', 'tix'],
  };

  it('allows access to a permitted provider', () => {
    expect(() => enforceProviderAccess(baseYaml, 'github')).not.toThrow();
    expect(() => enforceProviderAccess(baseYaml, 'tix')).not.toThrow();
  });

  it('throws for a non-permitted provider', () => {
    expect(() => enforceProviderAccess(baseYaml, 'slack')).toThrow(/not allowed to access provider/);
  });

  it('includes provider name in error message', () => {
    expect(() => enforceProviderAccess(baseYaml, 'notion')).toThrow(/notion/);
  });

  it('allows all providers when providers list is undefined', () => {
    const openYaml: PersonaYamlSchema = { ...baseYaml, providers: undefined };
    expect(() => enforceProviderAccess(openYaml, 'slack')).not.toThrow();
    expect(() => enforceProviderAccess(openYaml, 'notion')).not.toThrow();
  });

  it('denies all providers when providers list is explicitly empty', () => {
    const blockedYaml: PersonaYamlSchema = { ...baseYaml, providers: [] };
    expect(() => enforceProviderAccess(blockedYaml, 'github')).toThrow(/empty providers allow-list/);
    expect(() => enforceProviderAccess(blockedYaml, 'slack')).toThrow(/empty providers allow-list/);
  });
});
