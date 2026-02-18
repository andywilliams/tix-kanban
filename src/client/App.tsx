import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import KanbanBoard from './components/KanbanBoard';
import { WorkerStatus } from './components/WorkerStatus';
import { GitHubSettingsModal } from './components/GitHubSettingsModal';
import { SyncButton } from './components/SyncButton';
import { PersonasPage } from './components/PersonasPage';
import { PersonaDashboard } from './components/PersonaDashboard';
import PipelinesPage from './components/PipelinesPage';
import ChatPanel from './components/ChatPanel';
import { SettingsPage } from './components/SettingsPage';
import { ReportsPage } from './components/ReportsPage';
import { ReportDetail } from './components/ReportDetail';
import { KnowledgePage } from './components/KnowledgePage';
import { KnowledgeDetail } from './components/KnowledgeDetail';
import { StandupPage } from './components/StandupPage';
import { ActivityLogPage } from './components/ActivityLogPage';
import { Task } from './types';
import { useTasks } from './hooks/useTasks';
import { usePersonas } from './hooks/usePersonas';
import { useChat } from './hooks/useChat';
import './App.css';
import './github.css';
import './dashboard.css';

function AppContent() {
  const [darkMode, setDarkMode] = useState(true);
  const [githubSettingsOpen, setGithubSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [userName, setUserName] = useState('User');

  const { tasks, loading: tasksLoading, error: tasksError, createTask, updateTask, refetch } = useTasks();
  const { personas, loading: personasLoading } = usePersonas();
  const {
    channels,
    currentChannel,
    loading: chatLoading,
    switchChannel,
    sendMessage,
    createTaskChannel
  } = useChat(userName);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.settings?.userName) setUserName(data.settings.userName); })
      .catch(() => {});
  }, []);

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
            <Link 
              to="/dashboard" 
              className={`nav-link ${location.pathname === '/dashboard' ? 'active' : ''}`}
            >
              📊 Dashboard
            </Link>
            <Link
              to="/pipelines"
              className={`nav-link ${location.pathname === '/pipelines' ? 'active' : ''}`}
            >
              📋 Pipelines
            </Link>
            <Link
              to="/reports"
              className={`nav-link ${location.pathname.startsWith('/reports') ? 'active' : ''}`}
            >
              📄 Reports
            </Link>
            <Link
              to="/knowledge"
              className={`nav-link ${location.pathname.startsWith('/knowledge') ? 'active' : ''}`}
            >
              🧠 Knowledge
            </Link>
            <Link
              to="/standups"
              className={`nav-link ${location.pathname === '/standups' ? 'active' : ''}`}
            >
              📋 Standups
            </Link>
            <Link
              to="/activity-log"
              className={`nav-link ${location.pathname === '/activity-log' ? 'active' : ''}`}
            >
              📝 Activity Log
            </Link>
            <Link
              to="/settings"
              className={`nav-link ${location.pathname === '/settings' ? 'active' : ''}`}
            >
              ⚙️ Settings
            </Link>
          </nav>
        </div>
        <div className="header-actions">
          <SyncButton onSyncComplete={() => refetch()} />
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
                currentUser={userName}
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
            path="/dashboard"
            element={<PersonaDashboard />}
          />
          <Route
            path="/pipelines"
            element={<PipelinesPage />}
          />
          <Route
            path="/reports"
            element={<ReportsPage />}
          />
          <Route
            path="/reports/:id"
            element={<ReportDetail />}
          />
          <Route
            path="/knowledge"
            element={<KnowledgePage />}
          />
          <Route
            path="/knowledge/:id"
            element={<KnowledgeDetail />}
          />
          <Route
            path="/standups"
            element={<StandupPage />}
          />
          <Route
            path="/activity-log"
            element={<ActivityLogPage />}
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                onSettingsChange={(s) => setUserName(s.userName)}
              />
            }
          />
        </Routes>
      </main>

      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        currentChannel={currentChannel}
        channels={channels}
        personas={personas}
        currentUser={userName}
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