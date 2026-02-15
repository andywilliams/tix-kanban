import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import KanbanBoard from './components/KanbanBoard';
import { WorkerStatus } from './components/WorkerStatus';
import { GitHubSettingsModal } from './components/GitHubSettingsModal';
import { Task, Persona } from './types';
import { useTasks } from './hooks/useTasks';
import './App.css';
import './github.css';

const mockPersonas: Persona[] = [
  { id: 'qa', name: 'QA Engineer', emoji: '🔍', description: 'Quality assurance and testing', prompt: 'You are a QA engineer focused on testing and quality.' },
  { id: 'security', name: 'Security Reviewer', emoji: '🔒', description: 'Security analysis and reviews', prompt: 'You are a security expert reviewing code and systems for vulnerabilities.' },
  { id: 'tech-writer', name: 'Tech Writer', emoji: '📝', description: 'Documentation and writing', prompt: 'You are a technical writer focused on clear documentation.' },
  { id: 'bug-fixer', name: 'Bug Fixer', emoji: '🐛', description: 'Bug investigation and fixes', prompt: 'You are a developer who specializes in debugging and fixing issues.' },
  { id: 'developer', name: 'General Developer', emoji: '💻', description: 'General development tasks', prompt: 'You are a full-stack developer working on various coding tasks.' },
];

function App() {
  const { tasks, loading, error, createTask, updateTask } = useTasks();
  const [personas] = useState<Persona[]>(mockPersonas);
  const [darkMode, setDarkMode] = useState(true);
  const [githubSettingsOpen, setGithubSettingsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    await updateTask(taskId, updates);
  };

  const handleAddTask = async (newTask: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => {
    await createTask(newTask);
  };

  // Show loading state
  if (loading) {
    return (
      <div className={`app ${darkMode ? 'dark' : ''}`}>
        <div className="loading-container" style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '100vh',
          fontSize: '1.2em' 
        }}>
          🔄 Loading tasks...
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className={`app ${darkMode ? 'dark' : ''}`}>
        <div className="error-container" style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '100vh',
          fontSize: '1.2em',
          color: 'var(--color-danger, #ef4444)' 
        }}>
          <p>⚠️ Failed to load tasks</p>
          <p style={{ fontSize: '0.9em', opacity: 0.8 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`}>
      <Router>
        <header className="app-header">
          <h1>Tix Kanban</h1>
          <div className="header-actions">
            <button
              className="github-settings-btn"
              onClick={() => setGithubSettingsOpen(true)}
              aria-label="GitHub settings"
            >
              🐙 GitHub
            </button>
            <button
              className="theme-toggle"
              onClick={() => setDarkMode(!darkMode)}
              aria-label="Toggle dark mode"
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
          </div>
        </header>
        <main className="app-main">
          <WorkerStatus />
          <Routes>
            <Route
              path="/"
              element={
                <KanbanBoard
                  tasks={tasks}
                  personas={personas}
                  onUpdateTask={handleUpdateTask}
                  onAddTask={handleAddTask}
                />
              }
            />
          </Routes>
        </main>
      </Router>

      <GitHubSettingsModal
        isOpen={githubSettingsOpen}
        onClose={() => setGithubSettingsOpen(false)}
      />
    </div>
  );
}

export default App;