# Tix Kanban

A local kanban board with AI worker integration. Built with React, TypeScript, and Express.

## Features

- **4-column Kanban board**: Backlog, In Progress, Review, Done
- **Drag-and-drop**: Move tasks between columns using @dnd-kit
- **Task management**: Create, edit, and view detailed task information
- **Persona system**: Assign AI personas to tasks for specialized handling
- **Filtering**: Filter by assignee, persona, status, and tags
- **Dark mode**: DWLF-inspired dark theme (default)
- **Responsive design**: Works on desktop and mobile

## Quick Start

```bash
# Install dependencies
npm install

# Development mode (client + server)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Architecture

- **Frontend**: React + TypeScript + Vite
- **Backend**: Express.js for static serving
- **Styling**: CSS custom properties with dark/light themes
- **State**: Local React state (ready for API integration)

## Development

- Client runs on port 3000 (Vite dev server)
- Server runs on port 3001 (Express)
- Vite proxy forwards `/api` calls to the Express server

## Personas

Default personas included:
- 🔍 QA Engineer - Testing and quality assurance
- 🔒 Security Reviewer - Security analysis
- 📝 Tech Writer - Documentation
- 🐛 Bug Fixer - Debug and fix issues
- 💻 General Developer - Full-stack development

## Future Enhancements

- API backend for persistent storage
- GitHub integration (create PRs, sync issues)
- Built-in cron worker system
- Real-time updates
- Custom persona creation
- Time tracking
- Comments and links system