const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const archiver = require('archiver');

// Friendly names for photo slots
const slotNames = {
  'p1-dishwasher-latch': 'dishwasher-door-latch',
  'p2-humidifier': 'furnace-humidifier',
  'p3-sharkbite-connection': 'fridge-sharkbite-connection',
  'p4-laundry-current': 'laundry-room-current',
  'p4-laundry-planned': 'laundry-room-planned',
  'p5-sink-faucet': 'bathroom-sink-faucet'
};

const projectNames = {
  'p1-dishwasher-latch': 'Project1-Dishwasher',
  'p2-humidifier': 'Project2-Humidifier',
  'p3-sharkbite-connection': 'Project3-FridgeWater',
  'p4-laundry-current': 'Project4-LaundryRoom',
  'p4-laundry-planned': 'Project4-LaundryRoom',
  'p5-sink-faucet': 'Project5-BathroomSink'
};

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directory exists
const dataDir = process.env.DATA_DIR || './data';
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded images
app.use('/uploads', express.static(uploadsDir));

// API Routes

// Get all progress data including photos
app.get('/api/progress', (req, res) => {
  try {
    const checklist = db.prepare('SELECT id, checked FROM checklist_items').all();
    const notes = db.prepare('SELECT id, content FROM notes').all();
    const statuses = db.prepare('SELECT id, status FROM project_status').all();
    const photos = db.prepare('SELECT id, slot_id, filename, original_name, uploaded_at FROM photos ORDER BY uploaded_at DESC').all();

    // Group photos by slot
    const photosBySlot = photos.reduce((acc, photo) => {
      if (!acc[photo.slot_id]) {
        acc[photo.slot_id] = [];
      }
      acc[photo.slot_id].push({
        id: photo.id,
        filename: photo.filename,
        originalName: photo.original_name,
        uploadedAt: photo.uploaded_at
      });
      return acc;
    }, {});

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
      }, {}),
      photos: photosBySlot
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

// Upload photo
app.post('/api/photos/:slotId', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { slotId } = req.params;
    const timestamp = Date.now();
    const filename = `${slotId}-${timestamp}.jpg`;
    const filepath = path.join(uploadsDir, filename);

    // Process and save image with sharp (resize if too large, convert to jpg)
    await sharp(req.file.buffer)
      .rotate() // Auto-rotate based on EXIF
      .resize(1920, 1920, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 85 })
      .toFile(filepath);

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO photos (slot_id, filename, original_name)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(slotId, filename, req.file.originalname);

    res.json({
      success: true,
      photo: {
        id: result.lastInsertRowid,
        filename: filename,
        originalName: req.file.originalname
      }
    });
  } catch (error) {
    console.error('Error uploading photo:', error);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// Delete photo
app.delete('/api/photos/:photoId', (req, res) => {
  try {
    const { photoId } = req.params;

    // Get photo info
    const photo = db.prepare('SELECT filename FROM photos WHERE id = ?').get(photoId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Delete file
    const filepath = path.join(uploadsDir, photo.filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    // Delete from database
    db.prepare('DELETE FROM photos WHERE id = ?').run(photoId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting photo:', error);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// Download photos as zip for Claude
app.get('/api/photos/:slotId/download', (req, res) => {
  try {
    const { slotId } = req.params;

    // Get all photos for this slot
    const photos = db.prepare('SELECT id, filename, original_name, uploaded_at FROM photos WHERE slot_id = ? ORDER BY uploaded_at ASC').all(slotId);

    if (photos.length === 0) {
      return res.status(404).json({ error: 'No photos found' });
    }

    // Get friendly names
    const friendlySlotName = slotNames[slotId] || slotId;
    const projectName = projectNames[slotId] || 'HomeProject';
    const zipFilename = `${projectName}-photos.zip`;

    // Set headers for zip download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    // Create zip archive
    const archive = archiver('zip', { zlib: { level: 5 } });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      res.status(500).json({ error: 'Failed to create zip' });
    });

    // Pipe archive to response
    archive.pipe(res);

    // Add each photo to the archive with friendly names
    photos.forEach((photo, index) => {
      const filepath = path.join(uploadsDir, photo.filename);
      if (fs.existsSync(filepath)) {
        const friendlyFilename = `${friendlySlotName}-photo-${index + 1}.jpg`;
        archive.file(filepath, { name: friendlyFilename });
      }
    });

    // Finalize the archive
    archive.finalize();

  } catch (error) {
    console.error('Error creating photo download:', error);
    res.status(500).json({ error: 'Failed to download photos' });
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
  console.log(`Uploads directory: ${uploadsDir}`);
});
