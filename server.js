const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, `${timestamp}-${safeName}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed')); 
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/image/:name', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Image not found');
  }
  res.sendFile(filePath);
});

app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please upload an image file.' });
  }

  const imageUrl = `${req.protocol}://${req.get('host')}/image/${encodeURIComponent(req.file.filename)}`;
  const qrDataUrl = await QRCode.toDataURL(imageUrl, { margin: 2, width: 300 });

  res.json({
    imageUrl,
    qrDataUrl,
    fileName: req.file.filename
  });
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || 'Upload failed' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
