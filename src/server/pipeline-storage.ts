import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Pipeline, TaskPipelineState, PIPELINE_TEMPLATES } from '../client/types/pipeline.js';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const PIPELINES_DIR = path.join(STORAGE_DIR, 'pipelines');
const PIPELINE_STATES_DIR = path.join(STORAGE_DIR, 'pipeline-states');
const PIPELINES_SUMMARY_FILE = path.join(STORAGE_DIR, '_pipelines-summary.json');

interface PipelineSummary {
  id: string;
  name: string;
  isActive: boolean;
  stageCount: number;
  createdAt: string;
  updatedAt: string;
}

// Ensure storage directories exist
async function ensurePipelineDirectories(): Promise<void> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    await fs.mkdir(PIPELINES_DIR, { recursive: true });
    await fs.mkdir(PIPELINE_STATES_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create pipeline storage directories:', error);
    throw error;
  }
}

// Read pipeline from individual file
async function readPipeline(pipelineId: string): Promise<Pipeline | null> {
  try {
    const pipelinePath = path.join(PIPELINES_DIR, `${pipelineId}.json`);
    const content = await fs.readFile(pipelinePath, 'utf8');
    const pipeline = JSON.parse(content);
    
    // Convert date strings back to Date objects
    pipeline.createdAt = new Date(pipeline.createdAt);
    pipeline.updatedAt = new Date(pipeline.updatedAt);
    
    return pipeline;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null; // File doesn't exist
    }
    console.error(`Failed to read pipeline ${pipelineId}:`, error);
    throw error;
  }
}

// Write pipeline to individual file
async function writePipeline(pipeline: Pipeline): Promise<void> {
  try {
    await ensurePipelineDirectories();
    const pipelinePath = path.join(PIPELINES_DIR, `${pipeline.id}.json`);
    const content = JSON.stringify(pipeline, null, 2);
    await fs.writeFile(pipelinePath, content, 'utf8');
  } catch (error) {
    console.error(`Failed to write pipeline ${pipeline.id}:`, error);
    throw error;
  }
}

// Delete pipeline file
async function deletePipeline(pipelineId: string): Promise<boolean> {
  try {
    const pipelinePath = path.join(PIPELINES_DIR, `${pipelineId}.json`);
    await fs.unlink(pipelinePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false; // File doesn't exist
    }
    console.error(`Failed to delete pipeline ${pipelineId}:`, error);
    throw error;
  }
}

// Read pipelines summary file
async function readPipelinesSummary(): Promise<PipelineSummary[]> {
  try {
    const content = await fs.readFile(PIPELINES_SUMMARY_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []; // File doesn't exist yet
    }
    console.error('Failed to read pipelines summary:', error);
    throw error;
  }
}

// Update pipelines summary file
async function updatePipelinesSummary(pipelines: Pipeline[]): Promise<void> {
  try {
    await ensurePipelineDirectories();
    const summary: PipelineSummary[] = pipelines.map(pipeline => ({
      id: pipeline.id,
      name: pipeline.name,
      isActive: pipeline.isActive,
      stageCount: pipeline.stages.length,
      createdAt: pipeline.createdAt instanceof Date ? pipeline.createdAt.toISOString() : String(pipeline.createdAt),
      updatedAt: pipeline.updatedAt instanceof Date ? pipeline.updatedAt.toISOString() : String(pipeline.updatedAt),
    }));
    
    const content = JSON.stringify(summary, null, 2);
    await fs.writeFile(PIPELINES_SUMMARY_FILE, content, 'utf8');
  } catch (error) {
    console.error('Failed to update pipelines summary:', error);
    // Non-fatal — pipelines are stored individually, summary is just a cache
  }
}

// Get all pipelines
export async function getAllPipelines(): Promise<Pipeline[]> {
  try {
    // Try summary first for speed
    const summary = await readPipelinesSummary();
    if (summary.length > 0) {
      const pipelines: Pipeline[] = [];
      for (const pipelineSummary of summary) {
        const pipeline = await readPipeline(pipelineSummary.id);
        if (pipeline) {
          pipelines.push(pipeline);
        }
      }
      return pipelines;
    }
    
    // Fallback: scan pipelines directory directly
    await ensurePipelineDirectories();
    const files = await fs.readdir(PIPELINES_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const pipelines: Pipeline[] = [];
    for (const file of jsonFiles) {
      const pipelineId = file.replace('.json', '');
      const pipeline = await readPipeline(pipelineId);
      if (pipeline) {
        pipelines.push(pipeline);
      }
    }
    
    // Rebuild summary if we found pipelines
    if (pipelines.length > 0) {
      console.log(`🔧 Rebuilt pipelines summary from ${pipelines.length} pipeline files`);
      await updatePipelinesSummary(pipelines);
    }
    
    return pipelines;
  } catch (error) {
    console.error('Failed to get all pipelines:', error);
    return [];
  }
}

// Get single pipeline by ID
export async function getPipeline(pipelineId: string): Promise<Pipeline | null> {
  return await readPipeline(pipelineId);
}

// Create new pipeline
export async function createPipeline(pipelineData: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>): Promise<Pipeline> {
  const pipeline: Pipeline = {
    ...pipelineData,
    id: Math.random().toString(36).substr(2, 12), // Longer ID for pipelines
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await writePipeline(pipeline);
  
  // Update summary
  const allPipelines = await getAllPipelines();
  await updatePipelinesSummary(allPipelines);
  
  return pipeline;
}

// Update existing pipeline
export async function updatePipeline(pipelineId: string, updates: Partial<Pipeline>): Promise<Pipeline | null> {
  const existingPipeline = await readPipeline(pipelineId);
  if (!existingPipeline) {
    return null;
  }
  
  const updatedPipeline: Pipeline = {
    ...existingPipeline,
    ...updates,
    id: pipelineId, // Ensure ID doesn't change
    updatedAt: new Date(),
  };
  
  await writePipeline(updatedPipeline);
  
  // Update summary
  const allPipelines = await getAllPipelines();
  await updatePipelinesSummary(allPipelines);
  
  return updatedPipeline;
}

// Delete pipeline
export async function removePipeline(pipelineId: string): Promise<boolean> {
  const success = await deletePipeline(pipelineId);
  
  if (success) {
    // Update summary
    const allPipelines = await getAllPipelines();
    await updatePipelinesSummary(allPipelines);
  }
  
  return success;
}

// Pipeline state management (separate files for task-specific pipeline progress)
export async function getTaskPipelineState(taskId: string): Promise<TaskPipelineState | null> {
  try {
    const statePath = path.join(PIPELINE_STATES_DIR, `${taskId}.json`);
    const content = await fs.readFile(statePath, 'utf8');
    const state = JSON.parse(content);
    
    // Convert date strings back to Date objects
    state.createdAt = new Date(state.createdAt);
    state.updatedAt = new Date(state.updatedAt);
    state.stageHistory = state.stageHistory.map((history: any) => ({
      ...history,
      startedAt: new Date(history.startedAt),
      completedAt: history.completedAt ? new Date(history.completedAt) : undefined
    }));
    
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null; // File doesn't exist
    }
    console.error(`Failed to read pipeline state for task ${taskId}:`, error);
    throw error;
  }
}

export async function updateTaskPipelineState(state: TaskPipelineState): Promise<void> {
  try {
    await ensurePipelineDirectories();
    const statePath = path.join(PIPELINE_STATES_DIR, `${state.taskId}.json`);
    const content = JSON.stringify({
      ...state,
      updatedAt: new Date()
    }, null, 2);
    await fs.writeFile(statePath, content, 'utf8');
  } catch (error) {
    console.error(`Failed to write pipeline state for task ${state.taskId}:`, error);
    throw error;
  }
}

export async function deleteTaskPipelineState(taskId: string): Promise<void> {
  try {
    const statePath = path.join(PIPELINE_STATES_DIR, `${taskId}.json`);
    await fs.unlink(statePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to delete pipeline state for task ${taskId}:`, error);
    }
  }
}

// Initialize pipelines with templates
export async function initializePipelines(): Promise<void> {
  try {
    const pipelines = await getAllPipelines();
    if (pipelines.length === 0) {
      console.log('📋 No pipelines found — initializing with templates');
      
      // Create pipelines from templates
      for (const template of PIPELINE_TEMPLATES) {
        await createPipeline(template);
      }
      
      const createdCount = PIPELINE_TEMPLATES.length;
      console.log(`📋 Created ${createdCount} pipeline templates`);
    } else {
      console.log(`📋 Pipelines loaded: ${pipelines.length} found`);
    }
  } catch (error) {
    console.error('Failed to initialize pipelines:', error);
    throw error;
  }
}