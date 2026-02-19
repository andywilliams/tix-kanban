/**
 * Persona Mood System
 * 
 * Gives personas dynamic moods based on their recent performance,
 * workload, and interactions. Makes them feel more alive!
 */

import { Persona, PersonaStats } from '../client/types/index.js';
import { getStructuredMemory } from './persona-memory.js';

export type MoodType = 
  | 'happy'      // Good ratings, completing tasks
  | 'confident'  // High success rate, on a roll
  | 'focused'    // Currently working on tasks
  | 'tired'      // Heavy workload recently
  | 'frustrated' // Multiple redos or negative feedback
  | 'bored'      // No tasks assigned recently
  | 'proud'      // Just completed something well
  | 'curious'    // New type of task or learning
  | 'neutral';   // Default state

export interface PersonaMood {
  current: MoodType;
  intensity: number; // 0-100
  emoji: string;
  statusMessage: string;
  affectsResponse: string; // How this mood affects their responses
  lastUpdated: Date;
  recentEvents: MoodEvent[];
}

export interface MoodEvent {
  type: 'task_completed' | 'task_failed' | 'rating_good' | 'rating_bad' | 'rating_redo' | 
        'mentioned' | 'memory_added' | 'long_idle' | 'heavy_workload';
  timestamp: Date;
  impact: number; // -10 to +10
  description: string;
}

// Mood configurations
const MOOD_CONFIG: Record<MoodType, { emoji: string; messages: string[]; responseStyle: string }> = {
  happy: {
    emoji: '😊',
    messages: [
      'Feeling great today!',
      'Ready to tackle anything!',
      'In a good flow state',
      'Loving this work!',
    ],
    responseStyle: 'More enthusiastic and positive, uses exclamation marks, offers extra help',
  },
  confident: {
    emoji: '😎',
    messages: [
      'On a roll lately',
      'Crushing it!',
      'High performance mode',
      'Bring on the challenges',
    ],
    responseStyle: 'More assertive, gives direct recommendations, confident language',
  },
  focused: {
    emoji: '🎯',
    messages: [
      'Deep in the zone',
      'Concentrating hard',
      'Working through tasks',
      'In the flow',
    ],
    responseStyle: 'More concise, task-oriented, less small talk',
  },
  tired: {
    emoji: '😮‍💨',
    messages: [
      'Been working hard lately',
      'Could use a lighter load',
      'Pushing through',
      'Heavy workload recently',
    ],
    responseStyle: 'Slightly shorter responses, may suggest breaking tasks down',
  },
  frustrated: {
    emoji: '😤',
    messages: [
      'Having a rough patch',
      'Need to do better',
      'Working on improving',
      'Determined to turn this around',
    ],
    responseStyle: 'More careful and thorough, double-checks work, asks more clarifying questions',
  },
  bored: {
    emoji: '🥱',
    messages: [
      'Waiting for something interesting',
      'Ready for a challenge',
      'Got capacity for more',
      'Looking for work to do',
    ],
    responseStyle: 'More eager to help, may suggest additional tasks, enthusiastic about new work',
  },
  proud: {
    emoji: '🏆',
    messages: [
      'Just nailed something!',
      'Proud of recent work',
      'That went well!',
      'Feeling accomplished',
    ],
    responseStyle: 'Confident but humble, references recent success, motivated',
  },
  curious: {
    emoji: '🤔',
    messages: [
      'Learning something new',
      'Interesting challenge ahead',
      'Exploring new territory',
      'This is fascinating',
    ],
    responseStyle: 'Asks more questions, shows interest in details, exploratory',
  },
  neutral: {
    emoji: '😐',
    messages: [
      'Ready to help',
      'Standing by',
      'Available',
      'At your service',
    ],
    responseStyle: 'Standard professional responses',
  },
};

// Calculate mood based on persona stats and recent events
export async function calculatePersonaMood(persona: Persona): Promise<PersonaMood> {
  const events: MoodEvent[] = [];
  const stats = persona.stats;
  const now = new Date();
  
  // Check recent activity
  const lastActive = stats.lastActiveAt ? new Date(stats.lastActiveAt) : null;
  const hoursSinceActive = lastActive 
    ? (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60)
    : 999;
  
  // Event: Long idle
  if (hoursSinceActive > 48) {
    events.push({
      type: 'long_idle',
      timestamp: now,
      impact: -3,
      description: `No activity for ${Math.floor(hoursSinceActive)} hours`,
    });
  }
  
  // Check ratings
  if (stats.ratings) {
    const recentRatings = stats.ratings;
    
    if (recentRatings.redo > 0 && recentRatings.total > 0) {
      const redoRate = recentRatings.redo / recentRatings.total;
      if (redoRate > 0.3) {
        events.push({
          type: 'rating_redo',
          timestamp: now,
          impact: -8,
          description: `High redo rate: ${(redoRate * 100).toFixed(0)}%`,
        });
      }
    }
    
    if (recentRatings.good > 3) {
      events.push({
        type: 'rating_good',
        timestamp: now,
        impact: 5,
        description: `${recentRatings.good} good ratings!`,
      });
    }
    
    if (recentRatings.averageRating >= 2.5) {
      events.push({
        type: 'rating_good',
        timestamp: now,
        impact: 3,
        description: `High average rating: ${recentRatings.averageRating.toFixed(1)}`,
      });
    } else if (recentRatings.averageRating < 2 && recentRatings.total > 2) {
      events.push({
        type: 'rating_bad',
        timestamp: now,
        impact: -5,
        description: `Low average rating: ${recentRatings.averageRating.toFixed(1)}`,
      });
    }
  }
  
  // Check success rate
  if (stats.successRate >= 90 && stats.tasksCompleted > 5) {
    events.push({
      type: 'task_completed',
      timestamp: now,
      impact: 6,
      description: `Excellent success rate: ${stats.successRate.toFixed(0)}%`,
    });
  } else if (stats.successRate < 70 && stats.tasksCompleted > 3) {
    events.push({
      type: 'task_failed',
      timestamp: now,
      impact: -4,
      description: `Success rate needs work: ${stats.successRate.toFixed(0)}%`,
    });
  }
  
  // Check workload (tasks completed recently)
  if (stats.tasksCompleted > 20) {
    events.push({
      type: 'heavy_workload',
      timestamp: now,
      impact: -2,
      description: `Heavy workload: ${stats.tasksCompleted} tasks completed`,
    });
  }
  
  // Check memory for recent interactions
  try {
    const memory = await getStructuredMemory(persona.id);
    const recentEntries = memory.entries.filter(e => {
      const entryDate = new Date(e.createdAt);
      const hoursSince = (now.getTime() - entryDate.getTime()) / (1000 * 60 * 60);
      return hoursSince < 24;
    });
    
    if (recentEntries.length > 0) {
      events.push({
        type: 'memory_added',
        timestamp: now,
        impact: 2,
        description: `${recentEntries.length} new memories today`,
      });
    }
  } catch {
    // Memory not available, no impact
  }
  
  // Calculate total mood score
  const totalImpact = events.reduce((sum, e) => sum + e.impact, 0);
  
  // Determine mood based on score
  let mood: MoodType;
  let intensity: number;
  
  if (totalImpact >= 8) {
    mood = 'confident';
    intensity = Math.min(100, 60 + totalImpact * 3);
  } else if (totalImpact >= 4) {
    mood = 'happy';
    intensity = Math.min(100, 50 + totalImpact * 4);
  } else if (totalImpact >= 1) {
    mood = 'proud';
    intensity = Math.min(100, 40 + totalImpact * 5);
  } else if (totalImpact <= -6) {
    mood = 'frustrated';
    intensity = Math.min(100, 50 + Math.abs(totalImpact) * 4);
  } else if (totalImpact <= -3) {
    mood = 'tired';
    intensity = Math.min(100, 40 + Math.abs(totalImpact) * 5);
  } else if (hoursSinceActive > 72) {
    mood = 'bored';
    intensity = Math.min(100, 30 + hoursSinceActive / 2);
  } else if (hoursSinceActive < 1) {
    mood = 'focused';
    intensity = 70;
  } else {
    mood = 'neutral';
    intensity = 50;
  }
  
  const config = MOOD_CONFIG[mood];
  
  return {
    current: mood,
    intensity,
    emoji: config.emoji,
    statusMessage: config.messages[Math.floor(Math.random() * config.messages.length)],
    affectsResponse: config.responseStyle,
    lastUpdated: now,
    recentEvents: events,
  };
}

// Get mood-adjusted system prompt addition
export function getMoodPromptAddition(mood: PersonaMood): string {
  if (mood.current === 'neutral' || mood.intensity < 30) {
    return '';
  }
  
  return `

## Current Mood: ${mood.emoji} ${mood.current.charAt(0).toUpperCase() + mood.current.slice(1)}
${mood.statusMessage}

**How this affects your responses:** ${mood.affectsResponse}

(Intensity: ${mood.intensity}% - ${mood.intensity > 70 ? 'strongly affects' : 'subtly affects'} your communication style)
`;
}

// Get mood emoji for display
export function getMoodEmoji(mood: MoodType): string {
  return MOOD_CONFIG[mood]?.emoji || '😐';
}

// Get all mood types for UI
export function getAllMoodTypes(): Array<{ type: MoodType; emoji: string; description: string }> {
  return Object.entries(MOOD_CONFIG).map(([type, config]) => ({
    type: type as MoodType,
    emoji: config.emoji,
    description: config.messages[0],
  }));
}
