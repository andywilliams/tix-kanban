import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Board } from './components/Board'
import { Header } from './components/Header'
import './App.css'

function App() {
  return (
    <Router>
      <div className="app">
        <Header />
        <main className="main">
          <Routes>
            <Route path="/" element={<Board />} />
            <Route path="/cron" element={<div>Cron Management (TODO)</div>} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App