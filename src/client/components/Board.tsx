import { useState, useEffect } from 'react'

interface TaskSummary {
  taskId: string
  title: string
  status: string
  priority: number
  assignee?: string
  tags: string[]
  updatedAt: string
  commentCount: number
  linkCount: number
}

interface BoardData {
  backlog: TaskSummary[]
  'in-progress': TaskSummary[]
  review: TaskSummary[]
  done: TaskSummary[]
}

export function Board() {
  const [board, setBoard] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchBoard()
  }, [])

  const fetchBoard = async () => {
    try {
      const response = await fetch('/api/board')
      const data = await response.json()
      setBoard(data)
    } catch (error) {
      console.error('Failed to fetch board:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="loading">Loading board...</div>
  }

  if (!board) {
    return <div className="loading">Failed to load board</div>
  }

  const columns = [
    { key: 'backlog', title: 'Backlog', tasks: board.backlog },
    { key: 'in-progress', title: 'In Progress', tasks: board['in-progress'] },
    { key: 'review', title: 'Review', tasks: board.review },
    { key: 'done', title: 'Done', tasks: board.done }
  ]

  return (
    <div className="board">
      {columns.map(column => (
        <div key={column.key} className="column">
          <div className="column-header">
            <span>{column.title}</span>
            <span className="task-count">{column.tasks.length}</span>
          </div>
          
          {column.tasks.map(task => (
            <div key={task.taskId} className="task-card">
              <div className="task-title">{task.title}</div>
              
              <div className="task-meta">
                <span className="task-priority">P{task.priority}</span>
                {task.assignee && (
                  <span className="task-assignee">@{task.assignee}</span>
                )}
                {task.commentCount > 0 && (
                  <span>💬 {task.commentCount}</span>
                )}
                {task.linkCount > 0 && (
                  <span>🔗 {task.linkCount}</span>
                )}
              </div>
              
              {task.tags.length > 0 && (
                <div className="task-tags">
                  {task.tags.map(tag => (
                    <span key={tag} className="task-tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}