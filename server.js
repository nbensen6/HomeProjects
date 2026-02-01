const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directory exists
const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const db = new Database(path.join(dataDir, 'projects.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS checklist_items (
    id TEXT PRIMARY KEY,
    checked INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    content TEXT DEFAULT '',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_status (
    id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'pending',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// Get all progress data
app.get('/api/progress', (req, res) => {
  try {
    const checklist = db.prepare('SELECT id, checked FROM checklist_items').all();
    const notes = db.prepare('SELECT id, content FROM notes').all();
    const statuses = db.prepare('SELECT id, status FROM project_status').all();

    res.json({
      checklist: checklist.reduce((acc, item) => {
        acc[item.id] = item.checked === 1;
        return acc;
      }, {}),
      notes: notes.reduce((acc, item) => {
        acc[item.id] = item.content;
        return acc;
      }, {}),
      statuses: statuses.reduce((acc, item) => {
        acc[item.id] = item.status;
        return acc;
      }, {})
    });
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Update checklist item
app.post('/api/checklist/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { checked } = req.body;

    const stmt = db.prepare(`
      INSERT INTO checklist_items (id, checked, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET checked = ?, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(id, checked ? 1 : 0, checked ? 1 : 0);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating checklist:', error);
    res.status(500).json({ error: 'Failed to update checklist' });
  }
});

// Update note
app.post('/api/notes/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    const stmt = db.prepare(`
      INSERT INTO notes (id, content, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET content = ?, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(id, content, content);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Update project status
app.post('/api/status/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const stmt = db.prepare(`
      INSERT INTO project_status (id, status, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET status = ?, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(id, status, status);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Home Projects server running on port ${PORT}`);
  console.log(`Database location: ${path.join(dataDir, 'projects.db')}`);
});
