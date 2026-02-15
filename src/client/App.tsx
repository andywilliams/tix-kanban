import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import KanbanBoard from './components/KanbanBoard';
import { WorkerStatus } from './components/WorkerStatus';
import { GitHubSettingsModal } from './components/GitHubSettingsModal';
import { PersonasPage } from './components/PersonasPage';
import PipelinesPage from './components/PipelinesPage';
import { Task } from './types';
import { useTasks } from './hooks/useTasks';
import { usePersonas } from './hooks/usePersonas';
import './App.css';
import './github.css';

function AppContent() {
  const { tasks, loading: tasksLoading, error: tasksError, createTask, updateTask } = useTasks();
  const { personas, loading: personasLoading } = usePersonas();
  const [darkMode, setDarkMode] = useState(true);
  const [githubSettingsOpen, setGithubSettingsOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    await updateTask(taskId, updates);
  };

  const handleAddTask = async (newTask: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => {
    await createTask(newTask);
  };

  const isLoading = tasksLoading || personasLoading;
  const error = tasksError;

  // Show loading state
  if (isLoading) {
    return (
      <div className={`app ${darkMode ? 'dark' : ''}`}>
        <div className="loading-container" style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '100vh',
          fontSize: '1.2em' 
        }}>
          🔄 Loading...
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
          <p>⚠️ Failed to load application</p>
          <p style={{ fontSize: '0.9em', opacity: 0.8 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`}>
      <header className="app-header">
        <div className="header-left">
          <Link to="/" className="app-title">
            <h1>Tix Kanban</h1>
          </Link>
          <nav className="app-nav">
            <Link 
              to="/" 
              className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
            >
              📋 Board
            </Link>
            <Link 
              to="/personas" 
              className={`nav-link ${location.pathname === '/personas' ? 'active' : ''}`}
            >
              🤖 Personas
            </Link>
            <Link 
              to="/pipelines" 
              className={`nav-link ${location.pathname === '/pipelines' ? 'active' : ''}`}
            >
              📋 Pipelines
            </Link>
          </nav>
        </div>
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
          <Route
            path="/personas"
            element={<PersonasPage />}
          />
          <Route
            path="/pipelines"
            element={<PipelinesPage />}
          />
        </Routes>
      </main>

      <GitHubSettingsModal
        isOpen={githubSettingsOpen}
        onClose={() => setGithubSettingsOpen(false)}
      />
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;