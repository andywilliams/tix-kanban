import React, { useState, useEffect } from 'react';
import { Persona, Task } from '../types';
import { usePersonas } from '../hooks/usePersonas';
import { useTasks } from '../hooks/useTasks';
import { PersonaMemoryPanel } from './PersonaMemoryPanel';

interface DashboardStats {
  totalPersonas: number;
  activePersonas: number;
  totalTasksCompleted: number;
  averageSuccessRate: number;
  topPerformers: Array<{
    persona: Persona;
    completionRate: number;
    recentActivity: number;
  }>;
  taskDistribution: Array<{
    persona: string;
    taskCount: number;
    percentage: number;
  }>;
  recentActivity: Array<{
    persona: string;
    task: Task;
    action: string;
    timestamp: Date;
  }>;
}

export function PersonaDashboard() {
  const { personas, loading: personasLoading } = usePersonas();
  const { tasks, loading: tasksLoading } = useTasks();
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<'week' | 'month' | 'all'>('week');
  const [selectedPersonaForMemory, setSelectedPersonaForMemory] = useState<Persona | null>(null);

  useEffect(() => {
    if (personas.length > 0 && tasks.length > 0) {
      calculateDashboardStats();
    }
  }, [personas, tasks, selectedTimeframe]);

  const calculateDashboardStats = () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    let cutoffDate: Date;
    switch (selectedTimeframe) {
      case 'week': cutoffDate = weekAgo; break;
      case 'month': cutoffDate = monthAgo; break;
      default: cutoffDate = new Date(0); break;
    }

    // Filter tasks within timeframe
    const filteredTasks = selectedTimeframe === 'all' 
      ? tasks 
      : tasks.filter(task => new Date(task.updatedAt) >= cutoffDate);

    const completedTasks = filteredTasks.filter(task => task.status === 'done');
    const personaTasks = new Map<string, Task[]>();
    
    // Group tasks by persona
    filteredTasks.forEach(task => {
      if (task.persona) {
        if (!personaTasks.has(task.persona)) {
          personaTasks.set(task.persona, []);
        }
        personaTasks.get(task.persona)!.push(task);
      }
    });

    // Calculate top performers
    const topPerformers = personas
      .map(persona => {
        const personaCompletedTasks = completedTasks.filter(task => task.persona === persona.name);
        const personaAllTasks = filteredTasks.filter(task => task.persona === persona.name);
        
        const completionRate = personaAllTasks.length > 0 
          ? (personaCompletedTasks.length / personaAllTasks.length) * 100 
          : 0;
        
        const recentActivity = personaAllTasks.filter(task => 
          new Date(task.updatedAt) >= weekAgo
        ).length;

        return {
          persona,
          completionRate,
          recentActivity
        };
      })
      .sort((a, b) => b.completionRate - a.completionRate)
      .slice(0, 5);

    // Calculate task distribution
    const totalAssignedTasks = filteredTasks.filter(task => task.persona).length;
    const taskDistribution = Array.from(personaTasks.entries())
      .map(([personaName, tasks]) => ({
        persona: personaName,
        taskCount: tasks.length,
        percentage: totalAssignedTasks > 0 ? (tasks.length / totalAssignedTasks) * 100 : 0
      }))
      .sort((a, b) => b.taskCount - a.taskCount);

    // Recent activity
    const recentActivity = filteredTasks
      .filter(task => task.persona)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10)
      .map(task => ({
        persona: task.persona!,
        task,
        action: getTaskAction(task),
        timestamp: new Date(task.updatedAt)
      }));

    const activePersonas = personas.filter(persona => 
      persona.stats.lastActiveAt && new Date(persona.stats.lastActiveAt) >= weekAgo
    ).length;

    const totalTasksCompleted = personas.reduce((sum, persona) => 
      sum + persona.stats.tasksCompleted, 0
    );

    const averageSuccessRate = personas.length > 0 
      ? personas.reduce((sum, persona) => sum + persona.stats.successRate, 0) / personas.length
      : 0;

    setDashboardStats({
      totalPersonas: personas.length,
      activePersonas,
      totalTasksCompleted,
      averageSuccessRate,
      topPerformers,
      taskDistribution,
      recentActivity
    });
  };

  const getTaskAction = (task: Task): string => {
    switch (task.status) {
      case 'done': return 'Completed';
      case 'in-progress': return 'Working on';
      case 'review': return 'Under review';
      case 'auto-review': return 'Auto-reviewing';
      default: return 'Updated';
    }
  };

  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.round(minutes / 60 * 10) / 10;
    return `${hours}h`;
  };

  const getRatingEmoji = (rating: number): string => {
    if (rating >= 2.5) return '🟢';
    if (rating >= 2.0) return '🟡';
    return '🔴';
  };

  if (personasLoading || tasksLoading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (!dashboardStats) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-header">
          <h1 className="dashboard-title">Persona Dashboard</h1>
          <p className="dashboard-subtitle">Performance tracking and analytics</p>
        </div>
        <div className="dashboard-empty">
          <p>No data available yet. Complete some tasks to see performance metrics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Persona Dashboard</h1>
          <p className="dashboard-subtitle">Performance tracking and analytics</p>
        </div>
        <div className="dashboard-controls">
          <select 
            value={selectedTimeframe} 
            onChange={(e) => setSelectedTimeframe(e.target.value as 'week' | 'month' | 'all')}
            className="timeframe-select"
          >
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="dashboard-summary">
        <div className="summary-card">
          <div className="summary-icon">🤖</div>
          <div className="summary-content">
            <div className="summary-value">{dashboardStats.totalPersonas}</div>
            <div className="summary-label">Total Personas</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">⚡</div>
          <div className="summary-content">
            <div className="summary-value">{dashboardStats.activePersonas}</div>
            <div className="summary-label">Active This Week</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">✅</div>
          <div className="summary-content">
            <div className="summary-value">{dashboardStats.totalTasksCompleted}</div>
            <div className="summary-label">Tasks Completed</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">📊</div>
          <div className="summary-content">
            <div className="summary-value">{dashboardStats.averageSuccessRate.toFixed(1)}%</div>
            <div className="summary-label">Avg Success Rate</div>
          </div>
        </div>
      </div>

      <div className="dashboard-content">
        {/* Top Performers */}
        <div className="dashboard-section">
          <h2 className="section-title">🏆 Top Performers</h2>
          <div className="performers-grid">
            {dashboardStats.topPerformers.map((performer, index) => (
              <div key={performer.persona.id} className="performer-card">
                <div className="performer-rank">#{index + 1}</div>
                <div className="performer-avatar">{performer.persona.emoji}</div>
                <div className="performer-info">
                  <div className="performer-name">{performer.persona.name}</div>
                  <div className="performer-completion">
                    {performer.completionRate.toFixed(1)}% completion
                  </div>
                  <div className="performer-activity">
                    {performer.recentActivity} tasks this week
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Persona Performance Grid */}
        <div className="dashboard-section">
          <h2 className="section-title">📈 Performance Overview</h2>
          <div className="personas-performance-grid">
            {personas.map(persona => (
              <div key={persona.id} className="performance-card">
                <div className="performance-header">
                  <div className="performance-avatar">{persona.emoji}</div>
                  <div className="performance-name">{persona.name}</div>
                  {persona.stats.ratings && (
                    <div className="performance-rating">
                      {getRatingEmoji(persona.stats.ratings.averageRating)}
                    </div>
                  )}
                </div>
                
                <div className="performance-stats">
                  <div className="stat-row">
                    <span className="stat-label">Tasks Completed</span>
                    <span className="stat-value">{persona.stats.tasksCompleted}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Success Rate</span>
                    <span className="stat-value">{persona.stats.successRate.toFixed(1)}%</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Avg Time</span>
                    <span className="stat-value">{formatDuration(persona.stats.averageCompletionTime)}</span>
                  </div>
                  {persona.stats.ratings && (
                    <>
                      <div className="stat-row">
                        <span className="stat-label">Ratings</span>
                        <span className="stat-value">{persona.stats.ratings.total}</span>
                      </div>
                      <div className="rating-breakdown">
                        <span className="rating-good">✅ {persona.stats.ratings.good}</span>
                        <span className="rating-needs">⚠️ {persona.stats.ratings.needsImprovement}</span>
                        <span className="rating-redo">❌ {persona.stats.ratings.redo}</span>
                      </div>
                    </>
                  )}
                </div>
                
                <div className="performance-specialties">
                  {persona.specialties.slice(0, 3).map(specialty => (
                    <span key={specialty} className="specialty-tag">{specialty}</span>
                  ))}
                </div>
                
                <div className="performance-last-active">
                  {persona.stats.lastActiveAt 
                    ? `Active ${new Date(persona.stats.lastActiveAt).toLocaleDateString()}`
                    : 'No recent activity'
                  }
                </div>
                
                <button
                  onClick={() => setSelectedPersonaForMemory(persona)}
                  className="view-mind-btn"
                  style={{
                    marginTop: '0.75rem',
                    width: '100%',
                    padding: '0.5rem',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.375rem',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.background = 'var(--accent)';
                    (e.target as HTMLElement).style.color = 'white';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.background = 'var(--bg-tertiary)';
                    (e.target as HTMLElement).style.color = 'var(--text-secondary)';
                  }}
                >
                  🧠 View Mind & Memory
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Task Distribution */}
        <div className="dashboard-section">
          <h2 className="section-title">📊 Task Distribution</h2>
          <div className="distribution-chart">
            {dashboardStats.taskDistribution.map(item => (
              <div key={item.persona} className="distribution-bar">
                <div className="distribution-label">
                  <span className="distribution-persona">{item.persona}</span>
                  <span className="distribution-count">{item.taskCount} tasks</span>
                </div>
                <div className="distribution-progress">
                  <div 
                    className="distribution-fill" 
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
                <div className="distribution-percentage">{item.percentage.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="dashboard-section">
          <h2 className="section-title">🕒 Recent Activity</h2>
          <div className="activity-feed">
            {dashboardStats.recentActivity.map((activity, index) => (
              <div key={index} className="activity-item">
                <div className="activity-avatar">
                  {personas.find(p => p.name === activity.persona)?.emoji || '🤖'}
                </div>
                <div className="activity-content">
                  <div className="activity-line">
                    <strong>{activity.persona}</strong> {activity.action.toLowerCase()} 
                    <span className="activity-task">"{activity.task.title}"</span>
                  </div>
                  <div className="activity-time">
                    {activity.timestamp.toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Persona Memory Panel Modal */}
      {selectedPersonaForMemory && (
        <div 
          className="memory-panel-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '2rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedPersonaForMemory(null);
          }}
        >
          <div style={{ width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
            <PersonaMemoryPanel
              persona={selectedPersonaForMemory}
              onClose={() => setSelectedPersonaForMemory(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}