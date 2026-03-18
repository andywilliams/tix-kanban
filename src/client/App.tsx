import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';

interface NavDropdownItem {
  to: string;
  label: string;
  active: boolean;
}

function NavDropdown({ label, active, items }: { label: string; active: boolean; items: NavDropdownItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        className={`nav-link nav-dropdown-trigger ${active ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {label} ▾
      </button>
      {open && (
        <div className="nav-dropdown-menu">
          {items.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className={`nav-dropdown-item ${item.active ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
import KanbanBoard from './components/KanbanBoard';
import { WorkerStatus } from './components/WorkerStatus';
import { GitHubSettingsModal } from './components/GitHubSettingsModal';
import { SyncButton } from './components/SyncButton';
import { PersonasPage } from './components/PersonasPage';
import { PersonaDashboard } from './components/PersonaDashboard';
import { PersonaMemoriesPage } from './components/PersonaMemoriesPage';
import PipelinesPage from './components/PipelinesPage';
import TeamChatPanel from './components/TeamChatPanel';
import { SettingsPage } from './components/SettingsPage';
import { ReportsPage } from './components/ReportsPage';
import { ReportDetail } from './components/ReportDetail';
import { KnowledgePage } from './components/KnowledgePage';
import { KnowledgeDetail } from './components/KnowledgeDetail';
import { StandupPage } from './components/StandupPage';
import { ActivityLogPage } from './components/ActivityLogPage';
import { DailyNotesPage } from './components/DailyNotesPage';
import SlackSettings from './components/SlackSettings';
import SlackView from './components/SlackView';
import ReminderRulesPage from './components/ReminderRulesPage';
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
    unreadCounts,
    totalUnread,
    notifications,
    dismissNotification,
    switchChannel,
    sendMessage,
    createTaskChannel,
    createPersonaChannel,
    streamingMessageId,
    streamingText,
    isThinking
  } = useChat(userName);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Auto-dismiss notifications after 8 seconds
  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = setTimeout(() => {
      dismissNotification(notifications[0].id);
    }, 8000);
    return () => clearTimeout(timer);
  }, [notifications, dismissNotification]);

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
            <NavDropdown 
              label="🔧 Work" 
              active={['/pipelines', '/personas', '/dashboard', '/memories'].some(p => location.pathname.startsWith(p))}
              items={[
                { to: '/dashboard', label: '📊 Dashboard', active: location.pathname === '/dashboard' },
                { to: '/pipelines', label: '📋 Pipelines', active: location.pathname === '/pipelines' },
                { to: '/personas', label: '🤖 Personas', active: location.pathname === '/personas' },
                { to: '/memories', label: '🧠 Memories', active: location.pathname === '/memories' },
              ]}
            />
            <NavDropdown 
              label="📊 Insights" 
              active={['/reports', '/knowledge', '/standups', '/activity-log', '/daily-notes'].some(p => location.pathname.startsWith(p))}
              items={[
                { to: '/standups', label: '📋 Standups', active: location.pathname === '/standups' },
                { to: '/activity-log', label: '📝 Activity Log', active: location.pathname === '/activity-log' },
                { to: '/daily-notes', label: '🗒️ Daily Notes', active: location.pathname === '/daily-notes' },
                { to: '/reports', label: '📄 Reports', active: location.pathname.startsWith('/reports') },
                { to: '/knowledge', label: '🧠 Knowledge', active: location.pathname.startsWith('/knowledge') },
              ]}
            />
            <Link
              to="/slack"
              className={`nav-link ${location.pathname === '/slack' ? 'active' : ''}`}
            >
              💬 Slack
            </Link>
            <Link
              to="/reminders"
              className={`nav-link ${location.pathname === '/reminders' ? 'active' : ''}`}
            >
              🔔 Reminders
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
            onClick={() => setChatOpen(!chatOpen)}
            aria-label="Toggle team chat"
            style={{
              backgroundColor: chatOpen ? 'var(--color-primary, #3b82f6)' : '#f59e0b',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              position: 'relative',
            }}
          >
            🤝 Team Chat
            {totalUnread > 0 && (
              <span style={{
                position: 'absolute',
                top: '-6px',
                right: '-6px',
                background: '#ef4444',
                color: 'white',
                borderRadius: '9999px',
                minWidth: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: 700,
                padding: '0 5px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                animation: 'notification-pulse 2s ease-in-out infinite',
              }}>
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
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
            path="/memories"
            element={<PersonaMemoriesPage />}
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
            path="/daily-notes"
            element={<DailyNotesPage />}
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                onSettingsChange={(s) => setUserName(s.userName)}
              />
            }
          />
          <Route
            path="/reminders"
            element={<ReminderRulesPage />}
          />
          <Route
            path="/slack"
            element={<SlackView />}
          />
          <Route
            path="/settings/slack"
            element={<SlackSettings />}
          />
          <Route
            path="/settings/reminders"
            element={<ReminderRulesPage />}
          />
        </Routes>
      </main>

      <TeamChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        currentChannel={currentChannel}
        channels={channels}
        personas={personas}
        currentUser={userName}
        unreadCounts={unreadCounts}
        onSendMessage={sendMessage}
        onSwitchChannel={switchChannel}
        onCreateTaskChannel={createTaskChannel}
        onCreatePersonaChannel={createPersonaChannel}
        streamingMessageId={streamingMessageId}
        streamingText={streamingText}
        isThinking={isThinking}
        onStartDirectChat={async (personaId: string) => {
          // Start a direct chat with a persona
          try {
            const response = await fetch(`/api/personas/${personaId}/chat/start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: 'User' })
            });
            if (response.ok) {
              const data = await response.json();
              // Switch to the new channel
              if (data.channel) {
                switchChannel(data.channel);
              }
            }
          } catch (error) {
            console.error('Failed to start direct chat:', error);
          }
        }}
      />

      {/* Toast notifications for new persona messages */}
      {notifications.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '1rem',
          right: chatOpen ? '30rem' : '1rem',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          maxWidth: '22rem',
          transition: 'right 0.3s ease',
        }}>
          {notifications.map(n => (
            <div key={n.id} style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--accent)',
              borderRadius: '0.75rem',
              padding: '0.75rem 1rem',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              animation: 'toast-slide-in 0.3s ease-out',
              cursor: 'pointer',
            }}
            onClick={() => {
              const ch = channels.find(c => c.id === n.channelId);
              if (ch) {
                setChatOpen(true);
                switchChannel(ch);
              }
              dismissNotification(n.id);
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                  {n.author}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '0 0.25rem' }}
                >
                  ✕
                </button>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                in {n.channelName}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {n.content}
              </div>
            </div>
          ))}
        </div>
      )}

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