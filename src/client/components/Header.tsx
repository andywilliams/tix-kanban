import React from 'react'

export function Header() {
  return (
    <header className="header">
      <h1>
        📋 tix-kanban
      </h1>
      <div>
        <button onClick={() => window.location.href = '/cron'}>
          ⚙️ Cron
        </button>
      </div>
    </header>
  )
}