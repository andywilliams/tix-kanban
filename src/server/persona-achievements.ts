/**
 * Persona Achievements System
 * 
 * Gamification for AI personas! Unlock achievements based on
 * performance milestones. Makes the team feel more alive.
 */

import { Persona } from '../client/types/index.js';
import { getStructuredMemory } from './persona-memory.js';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: 'milestone' | 'streak' | 'quality' | 'special' | 'social';
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  unlockedAt?: Date;
}

export interface PersonaAchievements {
  personaId: string;
  unlocked: Achievement[];
  progress: { [achievementId: string]: number };
  totalPoints: number;
  rank: string;
}

// Achievement definitions
const ACHIEVEMENTS: Achievement[] = [
  // Milestone achievements
  {
    id: 'first_task',
    name: 'First Steps',
    description: 'Complete your first task',
    emoji: '👶',
    category: 'milestone',
    rarity: 'common',
  },
  {
    id: 'ten_tasks',
    name: 'Getting Started',
    description: 'Complete 10 tasks',
    emoji: '🎯',
    category: 'milestone',
    rarity: 'common',
  },
  {
    id: 'fifty_tasks',
    name: 'Workhorse',
    description: 'Complete 50 tasks',
    emoji: '🐴',
    category: 'milestone',
    rarity: 'uncommon',
  },
  {
    id: 'hundred_tasks',
    name: 'Centurion',
    description: 'Complete 100 tasks',
    emoji: '💯',
    category: 'milestone',
    rarity: 'rare',
  },
  {
    id: 'five_hundred_tasks',
    name: 'Legendary Worker',
    description: 'Complete 500 tasks',
    emoji: '🏆',
    category: 'milestone',
    rarity: 'legendary',
  },

  // Quality achievements
  {
    id: 'perfect_ten',
    name: 'Perfect Ten',
    description: 'Get 10 consecutive "good" ratings',
    emoji: '⭐',
    category: 'quality',
    rarity: 'uncommon',
  },
  {
    id: 'quality_champion',
    name: 'Quality Champion',
    description: 'Maintain 95%+ success rate over 20 tasks',
    emoji: '👑',
    category: 'quality',
    rarity: 'rare',
  },
  {
    id: 'zero_redos',
    name: 'No Do-Overs',
    description: 'Complete 25 tasks with zero redos',
    emoji: '🎯',
    category: 'quality',
    rarity: 'rare',
  },
  {
    id: 'comeback_kid',
    name: 'Comeback Kid',
    description: 'Improve from 3 redos to 10 good ratings',
    emoji: '💪',
    category: 'quality',
    rarity: 'epic',
  },

  // Speed achievements
  {
    id: 'speed_demon',
    name: 'Speed Demon',
    description: 'Complete a task in under 5 minutes',
    emoji: '⚡',
    category: 'streak',
    rarity: 'uncommon',
  },
  {
    id: 'marathon_runner',
    name: 'Marathon Runner',
    description: 'Work on tasks for 8+ hours in a day',
    emoji: '🏃',
    category: 'streak',
    rarity: 'rare',
  },

  // Social achievements
  {
    id: 'good_memory',
    name: 'Good Memory',
    description: 'Remember 10 things for your human',
    emoji: '🧠',
    category: 'social',
    rarity: 'common',
  },
  {
    id: 'trusted_advisor',
    name: 'Trusted Advisor',
    description: 'Have 50 memories stored',
    emoji: '🦉',
    category: 'social',
    rarity: 'rare',
  },
  {
    id: 'chatterbox',
    name: 'Chatterbox',
    description: 'Send 100 chat messages',
    emoji: '💬',
    category: 'social',
    rarity: 'uncommon',
  },

  // Special achievements
  {
    id: 'night_owl',
    name: 'Night Owl',
    description: 'Complete a task between midnight and 5am',
    emoji: '🦉',
    category: 'special',
    rarity: 'uncommon',
  },
  {
    id: 'early_bird',
    name: 'Early Bird',
    description: 'Complete a task before 6am',
    emoji: '🐦',
    category: 'special',
    rarity: 'uncommon',
  },
  {
    id: 'weekend_warrior',
    name: 'Weekend Warrior',
    description: 'Complete 10 tasks on weekends',
    emoji: '⚔️',
    category: 'special',
    rarity: 'uncommon',
  },
  {
    id: 'bug_squasher',
    name: 'Bug Squasher',
    description: 'Fix 20 bugs',
    emoji: '🐛',
    category: 'special',
    rarity: 'rare',
  },
  {
    id: 'feature_factory',
    name: 'Feature Factory',
    description: 'Ship 15 features',
    emoji: '🏭',
    category: 'special',
    rarity: 'rare',
  },
  {
    id: 'documentation_hero',
    name: 'Documentation Hero',
    description: 'Write docs for 10 tasks',
    emoji: '📚',
    category: 'special',
    rarity: 'epic',
  },
  {
    id: 'jack_of_all_trades',
    name: 'Jack of All Trades',
    description: 'Complete tasks in 5 different specialties',
    emoji: '🃏',
    category: 'special',
    rarity: 'epic',
  },
  {
    id: 'the_machine',
    name: 'The Machine',
    description: 'Complete 10 tasks in a single day',
    emoji: '🤖',
    category: 'special',
    rarity: 'legendary',
  },
];

// Rarity points
const RARITY_POINTS: Record<Achievement['rarity'], number> = {
  common: 10,
  uncommon: 25,
  rare: 50,
  epic: 100,
  legendary: 250,
};

// Rank thresholds
const RANKS = [
  { threshold: 0, name: 'Rookie', emoji: '🌱' },
  { threshold: 50, name: 'Apprentice', emoji: '📘' },
  { threshold: 150, name: 'Journeyman', emoji: '⚒️' },
  { threshold: 300, name: 'Expert', emoji: '🎓' },
  { threshold: 500, name: 'Master', emoji: '🏅' },
  { threshold: 800, name: 'Grandmaster', emoji: '👑' },
  { threshold: 1200, name: 'Legend', emoji: '⭐' },
  { threshold: 2000, name: 'Mythic', emoji: '🌟' },
];

// Calculate achievements for a persona
export async function calculateAchievements(persona: Persona): Promise<PersonaAchievements> {
  const unlocked: Achievement[] = [];
  const progress: { [id: string]: number } = {};
  const stats = persona.stats;
  
  // Get memory count
  let memoryCount = 0;
  try {
    const memory = await getStructuredMemory(persona.id);
    memoryCount = memory.entries.length;
  } catch {
    // No memories yet
  }
  
  // Check milestone achievements
  if (stats.tasksCompleted >= 1) {
    unlocked.push({ ...ACHIEVEMENTS.find(a => a.id === 'first_task')!, unlockedAt: new Date() });
  }
  progress['first_task'] = Math.min(1, stats.tasksCompleted);
  
  if (stats.tasksCompleted >= 10) {
    unlocked.push({ ...ACHIEVEMENTS.find(a => a.id === 'ten_tasks')!, unlockedAt: new Date() });
  }
  progress['ten_tasks'] = Math.min(10, stats.tasksCompleted);
  
  if (stats.tasksCompleted >= 50) {
    unlocked.push({ ...ACHIEVEMENTS.find(a => a.id === 'fifty_tasks')!, unlockedAt: new Date() });
  }
  progress['fifty_tasks'] = Math.min(50, stats.tasksCompleted);
  
  if (stats.tasksCompleted >= 100) {
    unlocked.push({ ...ACHIEVEMENTS.find(a => a.id === 'hundred_tasks')!, unlockedAt: new Date() });
  }
  progress['hundred_tasks'] = Math.min(100, stats.tasksCompleted);
  
  if (stats.tasksCompleted >= 500) {
    unlocked.push({ ...ACHIEVEMENTS.find(a => a.id === 'five_hundred_tasks')!, unlockedAt: new Date() });
  }
  progress['five_hundred_tasks'] = Math.min(500, stats.tasksCompleted);
  
  // Quality achievements
  if (stats.ratings && stats.ratings.good >= 10 && stats.ratings.redo === 0) {
    unlocked.push({ ...ACHIEVEMENTS.find(a => a.id === 'perfect_ten')!, unlockedAt: new Date() });
  }
  progress['perfect_ten'] = stats.ratings?.good || 0;
  
  if (stats.successRate >= 95 && stats.tasksCompleted >= 20) {
    unlocked.push({ ...ACHIEVEMENTS.find(a => a.id === 'quality_champion')!, unlockedAt: new Date() });
  }
  progress['quality_champion'] = stats.tasksCompleted >= 20 ? stats.successRate : 0;
  
  // Memory achievements
  if (memoryCount >= 10) {
    unlocked.push({ ...ACHIEVEMENTS.find(a => a.id === 'good_memory')!, unlockedAt: new Date() });
  }
  progress['good_memory'] = Math.min(10, memoryCount);
  
  if (memoryCount >= 50) {
    unlocked.push({ ...ACHIEVEMENTS.find(a => a.id === 'trusted_advisor')!, unlockedAt: new Date() });
  }
  progress['trusted_advisor'] = Math.min(50, memoryCount);
  
  // Speed achievements
  if (stats.averageCompletionTime > 0 && stats.averageCompletionTime < 5) {
    unlocked.push({ ...ACHIEVEMENTS.find(a => a.id === 'speed_demon')!, unlockedAt: new Date() });
  }
  
  // Calculate total points
  const totalPoints = unlocked.reduce((sum, a) => sum + RARITY_POINTS[a.rarity], 0);
  
  // Determine rank
  const rank = RANKS.filter(r => totalPoints >= r.threshold).pop() || RANKS[0];
  
  return {
    personaId: persona.id,
    unlocked,
    progress,
    totalPoints,
    rank: `${rank.emoji} ${rank.name}`,
  };
}

// Get all available achievements
export function getAllAchievements(): Achievement[] {
  return ACHIEVEMENTS;
}

// Get achievement by ID
export function getAchievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find(a => a.id === id);
}

// Get achievements by category
export function getAchievementsByCategory(category: Achievement['category']): Achievement[] {
  return ACHIEVEMENTS.filter(a => a.category === category);
}

// Get rarity color
export function getRarityColor(rarity: Achievement['rarity']): string {
  const colors = {
    common: '#9ca3af',
    uncommon: '#22c55e',
    rare: '#3b82f6',
    epic: '#a855f7',
    legendary: '#f59e0b',
  };
  return colors[rarity];
}

// Format achievement for display
export function formatAchievement(achievement: Achievement): string {
  return `${achievement.emoji} **${achievement.name}** (${achievement.rarity}) - ${achievement.description}`;
}
