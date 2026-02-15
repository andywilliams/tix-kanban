import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import KanbanBoard from './components/KanbanBoard';
import { WorkerStatus } from './components/WorkerStatus';
import { GitHubSettingsModal } from './components/GitHubSettingsModal';
import { PersonasPage } from './components/PersonasPage';
import ChatPanel from './components/ChatPanel';
import { Task } from './types';
import { useTasks } from './hooks/useTasks';
import { usePersonas } from './hooks/usePersonas';
import { useChat } from './hooks/useChat';
import './App.css';
import './github.css';

function AppContent() {
  const { tasks, loading: tasksLoading, error: tasksError, createTask, updateTask } = useTasks();
  const { personas, loading: personasLoading } = usePersonas();
  const { 
    channels, 
    currentChannel, 
    loading: chatLoading,
    switchChannel, 
    sendMessage, 
    createTaskChannel 
  } = useChat();
  const [darkMode, setDarkMode] = useState(true);
  const [githubSettingsOpen, setGithubSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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

  const isLoading = tasksLoading || personasLoading || chatLoading;
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
          </nav>
        </div>
        <div className="header-actions">
          <button
            className="chat-toggle"
            onClick={() => setChatOpen(!chatOpen)}
            aria-label="Toggle chat"
            style={{ 
              backgroundColor: chatOpen ? 'var(--color-primary, #3b82f6)' : 'transparent',
              color: chatOpen ? 'white' : 'inherit'
            }}
          >
            💬 Chat
          </button>
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
        </Routes>
      </main>

      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        currentChannel={currentChannel}
        channels={channels}
        personas={personas}
        currentUser="User" // TODO: Get actual user name
        onSendMessage={sendMessage}
        onSwitchChannel={switchChannel}
        onCreateTaskChannel={createTaskChannel}
      />

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