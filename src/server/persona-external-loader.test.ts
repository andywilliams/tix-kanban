import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import fs from 'fs/promises';
import {
  loadExternalPersona,
  loadExternalPersonas,
  clearPersonaCache,
  refreshExternalPersona,
} from './persona-external-loader.js';

// Mock axios and fs
vi.mock('axios');
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    realpath: vi.fn(),
    lstat: vi.fn(),
    access: vi.fn(),
  },
}));

describe('persona-external-loader', () => {
  // Allowed directory for file tests - matches persona-external-loader.ts ALLOWED_PERSONA_DIRS
  const allowedDir = '/root/.tix-kanban/personas';
  
  beforeEach(() => {
    clearPersonaCache();
    vi.clearAllMocks();
    // Mock realpath to return a path within allowed directory
    (fs.realpath as any).mockImplementation((path: string) => {
      // Strip the test path and replace with allowed dir to pass security check
      const filename = path.split('/').pop() || 'persona.yaml';
      return Promise.resolve(`${allowedDir}/${filename}`);
    });
  });

  afterEach(() => {
    clearPersonaCache();
  });

  describe('loadExternalPersona - URL sources', () => {
    it('should load persona from URL', async () => {
      const yamlContent = `
id: test-persona
name: Test Persona
emoji: 🧪
description: A test persona for unit tests
prompt: You are a test persona. This is a longer prompt to meet the minimum character requirement for validation.
specialties:
  - testing
  - validation
`;

      (axios.get as any).mockResolvedValue({
        status: 200,
        data: yamlContent,
      });

      const result = await loadExternalPersona({
        location: 'https://example.com/persona.yaml',
        type: 'url',
      });

      expect(result.persona.id).toBe('test-persona');
      expect(result.persona.name).toBe('Test Persona');
      expect(result.persona.emoji).toBe('🧪');
      expect(result.source.location).toBe('https://example.com/persona.yaml');
    });

    it('should cache URL responses', async () => {
      const yamlContent = `
id: cached-persona
name: Cached Persona
emoji: 💾
description: A persona to test caching behavior
prompt: You are a cached persona. This prompt is long enough to pass validation requirements.
specialties:
  - caching
`;

      (axios.get as any).mockResolvedValue({
        status: 200,
        data: yamlContent,
      });

      // First load
      await loadExternalPersona({
        location: 'https://example.com/cached.yaml',
        type: 'url',
        cacheDurationSeconds: 3600,
      });

      expect(axios.get).toHaveBeenCalledTimes(1);

      // Second load - should use cache
      await loadExternalPersona({
        location: 'https://example.com/cached.yaml',
        type: 'url',
        cacheDurationSeconds: 3600,
      });

      expect(axios.get).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should include auth token when provided', async () => {
      const yamlContent = `
id: authed-persona
name: Authenticated Persona
emoji: 🔐
description: A persona requiring authentication
prompt: You are an authenticated persona. This prompt meets the minimum length requirement.
specialties:
  - security
`;

      (axios.get as any).mockResolvedValue({
        status: 200,
        data: yamlContent,
      });

      await loadExternalPersona({
        location: 'https://example.com/private.yaml',
        type: 'url',
        authToken: 'secret-token',
      });

      expect(axios.get).toHaveBeenCalledWith(
        'https://example.com/private.yaml',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer secret-token',
          }),
        })
      );
    });

    it('should throw error on HTTP failure', async () => {
      (axios.get as any).mockRejectedValue(new Error('Network error'));

      await expect(
        loadExternalPersona({
          location: 'https://example.com/fail.yaml',
          type: 'url',
        })
      ).rejects.toThrow('Failed to fetch persona');
    });

    it('should throw error on invalid YAML', async () => {
      (axios.get as any).mockResolvedValue({
        status: 200,
        data: 'invalid: yaml: content:',
      });

      await expect(
        loadExternalPersona({
          location: 'https://example.com/invalid.yaml',
          type: 'url',
        })
      ).rejects.toThrow();
    });

    it('should throw error on validation failure', async () => {
      const invalidYaml = `
id: invalid-persona
name: Invalid
# Missing required fields
`;

      (axios.get as any).mockResolvedValue({
        status: 200,
        data: invalidYaml,
      });

      await expect(
        loadExternalPersona({
          location: 'https://example.com/invalid.yaml',
          type: 'url',
        })
      ).rejects.toThrow('Invalid persona YAML');
    });
  });

  describe('loadExternalPersona - file sources', () => {
    it('should load persona from file', async () => {
      const yamlContent = `
id: file-persona
name: File Persona
emoji: 📁
description: A persona loaded from the file system
prompt: You are a file-based persona. This prompt is sufficiently long for validation.
specialties:
  - file-io
  - local-storage
`;

      (fs.readFile as any).mockResolvedValue(yamlContent);

      const result = await loadExternalPersona({
        location: '/path/to/persona.yaml',
        type: 'file',
      });

      expect(result.persona.id).toBe('file-persona');
      expect(result.persona.name).toBe('File Persona');
    });

    it('should throw error on file not found', async () => {
      const error = new Error('File not found') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      (fs.readFile as any).mockRejectedValue(error);

      await expect(
        loadExternalPersona({
          location: '/nonexistent/persona.yaml',
          type: 'file',
        })
      ).rejects.toThrow('Persona file not found');
    });
  });

  describe('loadExternalPersonas - bulk loading', () => {
    it('should load multiple personas', async () => {
      const yaml1 = `
id: persona-1
name: Persona One
emoji: 1️⃣
description: First test persona
prompt: You are persona one. This prompt is long enough to meet requirements.
specialties: [one]
`;

      const yaml2 = `
id: persona-2
name: Persona Two
emoji: 2️⃣
description: Second test persona
prompt: You are persona two. This prompt is long enough to meet requirements.
specialties: [two]
`;

      (fs.readFile as any)
        .mockResolvedValueOnce(yaml1)
        .mockResolvedValueOnce(yaml2);

      const results = await loadExternalPersonas([
        { location: '/path/to/one.yaml', type: 'file' },
        { location: '/path/to/two.yaml', type: 'file' },
      ]);

      expect(results.loaded).toHaveLength(2);
      expect(results.loaded[0].persona.id).toBe('persona-1');
      expect(results.loaded[1].persona.id).toBe('persona-2');
    });

    it('should continue on partial failures', async () => {
      const validYaml = `
id: valid-persona
name: Valid Persona
emoji: ✅
description: A valid persona
prompt: You are a valid persona. This prompt meets the length requirement.
specialties: [validation]
`;

      (fs.readFile as any)
        .mockRejectedValueOnce(new Error('First file failed'))
        .mockResolvedValueOnce(validYaml);

      const results = await loadExternalPersonas([
        { location: '/path/to/fail.yaml', type: 'file' },
        { location: '/path/to/success.yaml', type: 'file' },
      ]);

      // Should return only the successful one
      expect(results.loaded).toHaveLength(1);
      expect(results.loaded[0].persona.id).toBe('valid-persona');
    });
  });

  describe('cache management', () => {
    it('should clear cache for specific location', async () => {
      const yamlContent = `
id: cache-test
name: Cache Test
emoji: 🗑️
description: Testing cache clearing
prompt: You are a cache test persona. This prompt is long enough.
specialties: [caching]
`;

      (axios.get as any).mockResolvedValue({
        status: 200,
        data: yamlContent,
      });

      const url = 'https://example.com/cache-test.yaml';

      // First load
      await loadExternalPersona({ location: url, type: 'url' });
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Second load (cached)
      await loadExternalPersona({ location: url, type: 'url' });
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Clear cache
      clearPersonaCache(url);

      // Third load (cache cleared, should fetch again)
      await loadExternalPersona({ location: url, type: 'url' });
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should refresh persona (force re-fetch)', async () => {
      const yamlContent = `
id: refresh-test
name: Refresh Test
emoji: 🔄
description: Testing refresh functionality
prompt: You are a refresh test persona. This prompt is long enough.
specialties: [refreshing]
`;

      (axios.get as any).mockResolvedValue({
        status: 200,
        data: yamlContent,
      });

      const source = {
        location: 'https://example.com/refresh.yaml',
        type: 'url' as const,
      };

      // First load
      await loadExternalPersona(source);
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Refresh (should bypass cache)
      await refreshExternalPersona(source);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('persona with invocations', () => {
    it('should preserve invocations field', async () => {
      const yamlContent = `
id: orchestrator
name: Orchestrator
emoji: 🎯
description: An orchestrator with invocation permissions
prompt: You are an orchestrator persona. This prompt is long enough.
specialties: [orchestration]
invocations:
  allow:
    - specialist-a
    - specialist-b
  maxConcurrent: 2
`;

      (axios.get as any).mockResolvedValue({
        status: 200,
        data: yamlContent,
      });

      const result = await loadExternalPersona({
        location: 'https://example.com/orchestrator.yaml',
        type: 'url',
      });

      expect(result.persona).toHaveProperty('invocations');
      expect((result.persona as any).invocations.allow).toEqual([
        'specialist-a',
        'specialist-b',
      ]);
      expect((result.persona as any).invocations.maxConcurrent).toBe(2);
    });
  });
});
