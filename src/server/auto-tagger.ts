/**
 * Auto-Tagger System
 * 
 * Automatically suggests and applies tags to tasks based on
 * content analysis. Uses keyword matching and pattern recognition.
 */

import { Task } from '../client/types/index.js';

export interface TagSuggestion {
  tag: string;
  confidence: number; // 0-1
  reason: string;
}

export interface TagPattern {
  tag: string;
  keywords: string[];
  patterns: RegExp[];
  excludePatterns?: RegExp[];
  weight?: number;
}

// Tag patterns for different categories
const TAG_PATTERNS: TagPattern[] = [
  // Technical areas
  {
    tag: 'frontend',
    keywords: ['react', 'vue', 'angular', 'css', 'html', 'ui', 'ux', 'component', 'button', 'form', 'layout', 'style', 'design', 'responsive'],
    patterns: [/\.(tsx|jsx|css|scss|vue)/, /front.?end/i, /user interface/i],
    weight: 1.0,
  },
  {
    tag: 'backend',
    keywords: ['api', 'server', 'database', 'endpoint', 'rest', 'graphql', 'query', 'migration', 'schema'],
    patterns: [/back.?end/i, /\.(ts|js)$/, /express|fastify|nest/i],
    weight: 1.0,
  },
  {
    tag: 'database',
    keywords: ['sql', 'postgres', 'mysql', 'mongo', 'redis', 'query', 'migration', 'schema', 'index', 'table'],
    patterns: [/database/i, /\bdb\b/i, /prisma|sequelize|mongoose/i],
    weight: 1.0,
  },
  {
    tag: 'api',
    keywords: ['endpoint', 'route', 'request', 'response', 'rest', 'graphql', 'webhook', 'integration'],
    patterns: [/\bapi\b/i, /\/api\//i, /http|https/i],
    weight: 0.9,
  },
  {
    tag: 'auth',
    keywords: ['login', 'logout', 'authentication', 'authorization', 'oauth', 'jwt', 'token', 'session', 'password', 'permissions'],
    patterns: [/auth/i, /sign.?in/i, /sign.?up/i],
    weight: 1.0,
  },
  {
    tag: 'testing',
    keywords: ['test', 'spec', 'jest', 'mocha', 'cypress', 'playwright', 'e2e', 'unit', 'integration', 'coverage'],
    patterns: [/\.test\.|\.spec\./i, /testing/i, /\bqa\b/i],
    weight: 1.0,
  },
  
  // Task types
  {
    tag: 'bug',
    keywords: ['bug', 'fix', 'issue', 'error', 'broken', 'crash', 'fail', 'wrong', 'incorrect'],
    patterns: [/\bbug\b/i, /doesn't work/i, /not working/i, /broken/i],
    excludePatterns: [/feature/i],
    weight: 1.2,
  },
  {
    tag: 'feature',
    keywords: ['feature', 'add', 'new', 'implement', 'create', 'build', 'develop'],
    patterns: [/\bfeature\b/i, /add support/i, /implement/i],
    excludePatterns: [/bug|fix|error/i],
    weight: 1.0,
  },
  {
    tag: 'refactor',
    keywords: ['refactor', 'cleanup', 'improve', 'optimize', 'restructure', 'reorganize', 'rewrite'],
    patterns: [/refactor/i, /clean.?up/i, /technical debt/i],
    weight: 0.9,
  },
  {
    tag: 'docs',
    keywords: ['document', 'documentation', 'readme', 'comment', 'jsdoc', 'api docs'],
    patterns: [/\bdocs?\b/i, /documentation/i, /readme/i],
    weight: 0.8,
  },
  {
    tag: 'performance',
    keywords: ['performance', 'speed', 'slow', 'fast', 'optimize', 'cache', 'lazy', 'memory'],
    patterns: [/performance/i, /too slow/i, /speed up/i, /optimize/i],
    weight: 1.0,
  },
  {
    tag: 'security',
    keywords: ['security', 'vulnerability', 'xss', 'csrf', 'injection', 'sanitize', 'encrypt', 'ssl', 'https'],
    patterns: [/security/i, /vulnerab/i, /\bxss\b/i, /\bcsrf\b/i],
    weight: 1.2,
  },
  
  // Priority indicators
  {
    tag: 'urgent',
    keywords: ['urgent', 'asap', 'critical', 'blocker', 'emergency', 'immediately'],
    patterns: [/\burgent\b/i, /\basap\b/i, /\bcritical\b/i, /\bblocker\b/i, /!!!+/],
    weight: 1.5,
  },
  {
    tag: 'quick-win',
    keywords: ['quick', 'easy', 'simple', 'small', 'minor', 'trivial'],
    patterns: [/quick.?win/i, /low.?hanging/i, /easy.?fix/i, /small change/i],
    weight: 0.8,
  },
  
  // Technology specific
  {
    tag: 'typescript',
    keywords: ['typescript', 'ts', 'type', 'interface', 'generic'],
    patterns: [/typescript/i, /\.ts$/, /type error/i],
    weight: 0.7,
  },
  {
    tag: 'react',
    keywords: ['react', 'hook', 'useState', 'useEffect', 'component', 'jsx', 'tsx'],
    patterns: [/\breact\b/i, /use[A-Z]\w+/],
    weight: 0.8,
  },
  {
    tag: 'node',
    keywords: ['node', 'npm', 'express', 'package', 'module'],
    patterns: [/\bnode\b/i, /nodejs/i, /npm|yarn|pnpm/i],
    weight: 0.7,
  },
  
  // Workflow
  {
    tag: 'blocked',
    keywords: ['blocked', 'waiting', 'depends', 'dependency', 'need'],
    patterns: [/blocked by/i, /waiting for/i, /depends on/i],
    weight: 1.0,
  },
  {
    tag: 'needs-review',
    keywords: ['review', 'feedback', 'check', 'verify'],
    patterns: [/needs? review/i, /please review/i, /code review/i],
    weight: 0.9,
  },
  {
    tag: 'research',
    keywords: ['research', 'investigate', 'explore', 'analyze', 'spike', 'prototype'],
    patterns: [/research/i, /investigate/i, /spike/i, /poc|proof of concept/i],
    weight: 0.9,
  },
];

// Calculate tag suggestions for a task
export function suggestTags(task: Task): TagSuggestion[] {
  const suggestions: TagSuggestion[] = [];
  const content = `${task.title} ${task.description}`.toLowerCase();
  
  for (const pattern of TAG_PATTERNS) {
    // Skip if task already has this tag
    if (task.tags.includes(pattern.tag)) {
      continue;
    }
    
    // Check exclude patterns
    if (pattern.excludePatterns?.some(p => p.test(content))) {
      continue;
    }
    
    let score = 0;
    const reasons: string[] = [];
    
    // Keyword matching
    for (const keyword of pattern.keywords) {
      if (content.includes(keyword)) {
        score += 1;
        reasons.push(`contains "${keyword}"`);
      }
    }
    
    // Pattern matching
    for (const regex of pattern.patterns) {
      if (regex.test(content) || regex.test(task.title)) {
        score += 2;
        reasons.push(`matches pattern`);
      }
    }
    
    // Title matches are more significant
    const titleLower = task.title.toLowerCase();
    for (const keyword of pattern.keywords) {
      if (titleLower.includes(keyword)) {
        score += 1; // Extra point for title match
      }
    }
    
    if (score > 0) {
      // Normalize score to 0-1 confidence
      const maxPossibleScore = pattern.keywords.length + (pattern.patterns.length * 2) + pattern.keywords.length;
      let confidence = Math.min(1, (score / Math.max(maxPossibleScore, 5)) * (pattern.weight || 1));
      
      // Boost confidence if multiple matches
      if (reasons.length > 2) {
        confidence = Math.min(1, confidence * 1.2);
      }
      
      if (confidence >= 0.3) { // Only suggest if reasonably confident
        suggestions.push({
          tag: pattern.tag,
          confidence: Math.round(confidence * 100) / 100,
          reason: reasons.slice(0, 3).join(', '),
        });
      }
    }
  }
  
  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence);
  
  // Return top suggestions
  return suggestions.slice(0, 5);
}

// Auto-apply high-confidence tags
export function autoApplyTags(task: Task, confidenceThreshold: number = 0.7): string[] {
  const suggestions = suggestTags(task);
  const newTags: string[] = [];
  
  for (const suggestion of suggestions) {
    if (suggestion.confidence >= confidenceThreshold) {
      if (!task.tags.includes(suggestion.tag)) {
        newTags.push(suggestion.tag);
      }
    }
  }
  
  return newTags;
}

// Get tags that should be removed based on content
export function suggestTagRemovals(task: Task): Array<{ tag: string; reason: string }> {
  const removals: Array<{ tag: string; reason: string }> = [];
  const content = `${task.title} ${task.description}`.toLowerCase();
  
  for (const tag of task.tags) {
    const pattern = TAG_PATTERNS.find(p => p.tag === tag);
    if (!pattern) continue;
    
    // Check if any keywords still match
    const hasMatch = pattern.keywords.some(kw => content.includes(kw)) ||
                     pattern.patterns.some(p => p.test(content));
    
    if (!hasMatch) {
      removals.push({
        tag,
        reason: 'No longer matches task content',
      });
    }
  }
  
  return removals;
}

// Get all available auto-tags
export function getAllAutoTags(): string[] {
  return [...new Set(TAG_PATTERNS.map(p => p.tag))].sort();
}

// Analyze task and return comprehensive tagging info
export function analyzeTaskTags(task: Task): {
  suggestions: TagSuggestion[];
  autoApply: string[];
  removals: Array<{ tag: string; reason: string }>;
  existingTags: string[];
  allTags: string[];
} {
  return {
    suggestions: suggestTags(task),
    autoApply: autoApplyTags(task),
    removals: suggestTagRemovals(task),
    existingTags: task.tags,
    allTags: getAllAutoTags(),
  };
}
