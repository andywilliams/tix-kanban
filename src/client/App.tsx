import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import KanbanBoard from './components/KanbanBoard';
import { Task, Persona } from './types';
import './App.css';

const mockPersonas: Persona[] = [
  { id: 'qa', name: 'QA Engineer', emoji: '🔍', description: 'Quality assurance and testing', prompt: 'You are a QA engineer focused on testing and quality.' },
  { id: 'security', name: 'Security Reviewer', emoji: '🔒', description: 'Security analysis and reviews', prompt: 'You are a security expert reviewing code and systems for vulnerabilities.' },
  { id: 'tech-writer', name: 'Tech Writer', emoji: '📝', description: 'Documentation and writing', prompt: 'You are a technical writer focused on clear documentation.' },
  { id: 'bug-fixer', name: 'Bug Fixer', emoji: '🐛', description: 'Bug investigation and fixes', prompt: 'You are a developer who specializes in debugging and fixing issues.' },
  { id: 'developer', name: 'General Developer', emoji: '💻', description: 'General development tasks', prompt: 'You are a full-stack developer working on various coding tasks.' },
];

const mockTasks: Task[] = [
  {
    id: '1',
    title: 'Fix authentication bug',
    description: 'Users cannot log in with Google OAuth',
    status: 'backlog',
    priority: 100,
    assignee: 'jenna@dwlf.co.uk',
    persona: 'bug-fixer',
    tags: ['bug', 'auth'],
    createdAt: new Date('2026-02-14T10:00:00Z'),
    updatedAt: new Date('2026-02-14T10:00:00Z'),
  },
  {
    id: '2',
    title: 'Add dark mode support',
    description: 'Implement dark theme across the application',
    status: 'in-progress',
    priority: 75,
    assignee: 'jenna@dwlf.co.uk',
    persona: 'developer',
    tags: ['feature', 'ui'],
    createdAt: new Date('2026-02-14T09:00:00Z'),
    updatedAt: new Date('2026-02-14T11:00:00Z'),
  },
  {
    id: '3',
    title: 'Write API documentation',
    description: 'Document the REST API endpoints',
    status: 'review',
    priority: 50,
    assignee: 'andy@dwlf.co.uk',
    persona: 'tech-writer',
    tags: ['docs', 'api'],
    createdAt: new Date('2026-02-14T08:00:00Z'),
    updatedAt: new Date('2026-02-14T12:00:00Z'),
  },
];

function App() {
  const [tasks, setTasks] = useState<Task[]>(mockTasks);
  const [personas] = useState<Persona[]>(mockPersonas);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const updateTask = (taskId: string, updates: Partial<Task>) => {
    setTasks(prev => prev.map(task => 
      task.id === taskId 
        ? { ...task, ...updates, updatedAt: new Date() }
        : task
    ));
  };

  const addTask = (newTask: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => {
    const task: Task = {
      ...newTask,
      id: Math.random().toString(36).substr(2, 9),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setTasks(prev => [...prev, task]);
  };

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`}>
      <Router>
        <header className="app-header">
          <h1>Tix Kanban</h1>
          <button
            className="theme-toggle"
            onClick={() => setDarkMode(!darkMode)}
            aria-label="Toggle dark mode"
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
        </header>
        <Routes>
          <Route
            path="/"
            element={
              <KanbanBoard
                tasks={tasks}
                personas={personas}
                onUpdateTask={updateTask}
                onAddTask={addTask}
              />
            }
          />
        </Routes>
      </Router>
    </div>
  );
}

export default App;