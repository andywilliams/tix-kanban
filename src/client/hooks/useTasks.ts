import { useState, useEffect, useCallback } from 'react';
import { Task } from '../types';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  loading: boolean;
}

interface TasksApiResponse {
  tasks: Task[];
}

interface TaskApiResponse {
  task: Task;
}

const API_BASE = '/api';

// Custom hook for task API operations
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all tasks
  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${API_BASE}/tasks`);
      if (!response.ok) {
        throw new Error(`Failed to fetch tasks: ${response.statusText}`);
      }
      
      const data: TasksApiResponse = await response.json();
      
      // Convert date strings back to Date objects
      const tasksWithDates = data.tasks.map(task => ({
        ...task,
        createdAt: new Date(task.createdAt),
        updatedAt: new Date(task.updatedAt),
        dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
        comments: task.comments?.map(comment => ({
          ...comment,
          createdAt: new Date(comment.createdAt),
        })),
      }));
      
      setTasks(tasksWithDates);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(errorMessage);
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Create a new task
  const createTask = useCallback(async (taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task | null> => {
    try {
      const response = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(taskData),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create task: ${response.statusText}`);
      }
      
      const data: TaskApiResponse = await response.json();
      const newTask = {
        ...data.task,
        createdAt: new Date(data.task.createdAt),
        updatedAt: new Date(data.task.updatedAt),
        dueDate: data.task.dueDate ? new Date(data.task.dueDate) : undefined,
        comments: data.task.comments?.map(comment => ({
          ...comment,
          createdAt: new Date(comment.createdAt),
        })),
      };
      
      setTasks(prev => [...prev, newTask]);
      return newTask;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create task';
      console.error('Create task error:', err);
      setError(errorMessage);
      return null;
    }
  }, []);

  // Update an existing task
  const updateTask = useCallback(async (taskId: string, updates: Partial<Task>): Promise<Task | null> => {
    try {
      const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to update task: ${response.statusText}`);
      }
      
      const data: TaskApiResponse = await response.json();
      const updatedTask = {
        ...data.task,
        createdAt: new Date(data.task.createdAt),
        updatedAt: new Date(data.task.updatedAt),
        dueDate: data.task.dueDate ? new Date(data.task.dueDate) : undefined,
        comments: data.task.comments?.map(comment => ({
          ...comment,
          createdAt: new Date(comment.createdAt),
        })),
      };
      
      setTasks(prev => prev.map(task => 
        task.id === taskId ? updatedTask : task
      ));
      
      return updatedTask;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update task';
      console.error('Update task error:', err);
      setError(errorMessage);
      return null;
    }
  }, []);

  // Delete a task
  const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete task: ${response.statusText}`);
      }
      
      setTasks(prev => prev.filter(task => task.id !== taskId));
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete task';
      console.error('Delete task error:', err);
      setError(errorMessage);
      return false;
    }
  }, []);

  // Load tasks on mount
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return {
    tasks,
    loading,
    error,
    createTask,
    updateTask,
    deleteTask,
    refetch: fetchTasks,
  };
}