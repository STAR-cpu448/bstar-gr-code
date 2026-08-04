// WEBCODE: Apple UI + 3-day device/IP trial paywall implementation
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const fetch = require('node-fetch');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadsDir = path.join(os.tmpdir(), 'webcode-uploads');
const recordsPath = path.join(os.tmpdir(), 'webcode-records.json');
const TRIAL_MS = 72 * 60 * 60 * 1000;

function loadRecords() {
  try {
    if (!fs.existsSync(recordsPath)) return { devices: {} };
    return JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
  } catch (error) {
    console.warn('Failed to load records:', error.message);
    return { devices: {} };
  }
}

function saveRecords(records) {
  fs.writeFileSync(recordsPath, JSON.stringify(records, null, 2));
}

const records = loadRecords();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}

function getBrowserFingerprint(req) {
  return req.body.fingerprint || req.query.fingerprint || 'unknown-fingerprint';
}

function createDeviceHash(ip, fingerprint) {
  return crypto.createHash('sha256').update(`${ip}|${fingerprint}`).digest('hex');
}

function getDeviceRecord(deviceHash) {
  return records.devices[deviceHash];
}

function updateDeviceRecord(deviceHash, update) {
  const existing = getDeviceRecord(deviceHash) || {};
  records.devices[deviceHash] = { ...existing, ...update };
  saveRecords(records);
  return records.devices[deviceHash];
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function isAdmin(req) {
  const email = req.body.email || req.query.email || ''; 
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminKey = req.body.adminKey || req.query.adminKey || req.headers['x-admin-key'] || '';
  const bypassKey = process.env.ADMIN_BYPASS_KEY;
  return (!!adminEmail && email.toLowerCase() === adminEmail.toLowerCase()) || (!!bypassKey && adminKey === bypassKey);
}

function trialStatusFor(record) {
  if (!record) return { state: 'new', daysLeft: 0 };
  if (record.admin || record.paid) return { state: 'paid', daysLeft: 0 };
  if (!record.firstAccessDate) return { state: 'new', daysLeft: 0 };
  const elapsed = Date.now() - new Date(record.firstAccessDate).getTime();
  if (elapsed <= TRIAL_MS) {
    return { state: 'trial', daysLeft: Math.ceil((TRIAL_MS - elapsed) / (24 * 60 * 60 * 1000)) };
  }
  return { state: 'expired', daysLeft: 0 };
}

function ensureUploadsDir() {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

ensureUploadsDir();

app.get('/sitemap.xml', (req, res) => {
  const host = `${req.protocol}://${req.get('host')}`;
  const urls = [
    `${host}/`,
    `${host}/` // root only; uploaded images are dynamic and not listed here
  ];

  const urlset = urls.map(u => `    <url>\n      <loc>${u}</loc>\n    </url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlset}\n</urlset>`;
  res.type('application/xml').send(xml);
});

app.get('/image/:name', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Image not found');
  }
  res.sendFile(filePath);
});

app.get('/api/trial/status', (req, res) => {
  const fingerprint = req.query.fingerprint || 'unknown';
  const email = (req.query.email || '').toLowerCase();
  const phone = req.query.phone || '';
  const adminKey = req.query.adminKey || req.headers['x-admin-key'] || '';
  const ip = getClientIp(req);
  const deviceHash = createDeviceHash(ip, fingerprint);
  const record = getDeviceRecord(deviceHash);

  if (record) {
    const status = trialStatusFor(record);
    return res.json({
      state: status.state,
      daysLeft: status.daysLeft,
      paid: record.paid || record.admin,
      admin: record.admin || false,
      email: record.email || email,
      phone: record.phone || phone
    });
  }

  const isAdminUser = (!!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase()) || (!!process.env.ADMIN_BYPASS_KEY && adminKey === process.env.ADMIN_BYPASS_KEY);
  if (isAdminUser) {
    updateDeviceRecord(deviceHash, { admin: true, paid: true, email, phone, firstAccessDate: new Date().toISOString() });
    return res.json({ state: 'paid', daysLeft: 0, paid: true, admin: true, email, phone });
  }

  res.json({ state: 'new', daysLeft: 0, paid: false, admin: false, email, phone });
});

app.post('/api/trial/start', (req, res) => {
  const { fingerprint, email, phone } = req.body;
  const ip = getClientIp(req);
  const deviceHash = createDeviceHash(ip, fingerprint || 'unknown');
  const record = getDeviceRecord(deviceHash) || {};
  const isAdminUser = isAdmin(req);

  if (isAdminUser) {
    updateDeviceRecord(deviceHash, {
      admin: true,
      paid: true,
      email: (email || '').toLowerCase(),
      phone: phone || '',
      firstAccessDate: new Date().toISOString()
    });
    return res.json({ state: 'paid', daysLeft: 0, paid: true, admin: true });
  }

  if (!record.firstAccessDate) {
    updateDeviceRecord(deviceHash, {
      firstAccessDate: new Date().toISOString(),
      email: (email || '').toLowerCase(),
      phone: phone || '',
      fingerprint: fingerprint || 'unknown',
      ip,
      paid: false,
      admin: false
    });
  }

  const updated = getDeviceRecord(deviceHash);
  const status = trialStatusFor(updated);
  res.json({ state: status.state, daysLeft: status.daysLeft, paid: false, admin: false });
});

app.get('/api/trial/status', (req, res) => {
  const fingerprint = req.query.fingerprint || 'unknown';
  const email = (req.query.email || '').toLowerCase();
  const phone = req.query.phone || '';
  const adminKey = req.query.adminKey || req.headers['x-admin-key'] || '';
  const ip = getClientIp(req);
  const deviceHash = createDeviceHash(ip, fingerprint);
  const record = getDeviceRecord(deviceHash);

  if (record) {
    const status = trialStatusFor(record);
    return res.json({
      state: status.state,
      daysLeft: status.daysLeft,
      paid: record.paid || record.admin,
      admin: record.admin || false,
      email: record.email || email,
      phone: record.phone || phone
    });
  }

  const isAdminUser = (!!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase()) || (!!process.env.ADMIN_BYPASS_KEY && adminKey === process.env.ADMIN_BYPASS_KEY);
  if (isAdminUser) {
    updateDeviceRecord(deviceHash, { admin: true, paid: true, email, phone, firstAccessDate: new Date().toISOString() });
    return res.json({ state: 'paid', daysLeft: 0, paid: true, admin: true, email, phone });
  }

  res.json({ state: 'new', daysLeft: 0, paid: false, admin: false, email, phone });
});

app.post('/api/trial/start', (req, res) => {
  const { fingerprint, email, phone } = req.body;
  const ip = getClientIp(req);
  const deviceHash = createDeviceHash(ip, fingerprint || 'unknown');
  const record = getDeviceRecord(deviceHash) || {};
  const isAdminUser = isAdmin(req);

  if (isAdminUser) {
    updateDeviceRecord(deviceHash, {
      admin: true,
      paid: true,
      email: (email || '').toLowerCase(),
      phone: phone || '',
      firstAccessDate: new Date().toISOString()
    });
    return res.json({ state: 'paid', daysLeft: 0, paid: true, admin: true });
  }

  if (!record.firstAccessDate) {
    updateDeviceRecord(deviceHash, {
      firstAccessDate: new Date().toISOString(),
      email: (email || '').toLowerCase(),
      phone: phone || '',
      fingerprint: fingerprint || 'unknown',
      ip,
      paid: false,
      admin: false
    });
  }

  const updated = getDeviceRecord(deviceHash);
  const status = trialStatusFor(updated);
  res.json({ state: status.state, daysLeft: status.daysLeft, paid: false, admin: false });
});

app.post('/api/payments/create', async (req, res) => {
  const { email, phone, fingerprint } = req.body;
  const ip = getClientIp(req);
  const deviceHash = createDeviceHash(ip, fingerprint || 'unknown');
  const record = getDeviceRecord(deviceHash) || {};

  if (record.paid || record.admin) {
    return res.json({ paid: true, message: 'Device already unlocked.' });
  }

  const paystackSecret = process.env.PAYSTACK_SECRET;
  if (!paystackSecret) {
    return res.status(500).json({ error: 'Payment provider not configured.' });
  }

  const reference = `WEBCODE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestBody = {
    email: email || 'unknown@webcode.com',
    amount: 9900,
    currency: 'KES',
    channels: ['card', 'mobile_money'],
    metadata: {
      phone: phone || '0742562742',
      deviceHash,
      payoutPhone: '0742562742'
    },
    reference
  };

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${paystackSecret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();
  if (!response.ok || !data.status) {
    return res.status(500).json({ error: data.message || 'Payment initialization failed', details: data });
  }

  updateDeviceRecord(deviceHash, {
    email: (email || '').toLowerCase(),
    phone: phone || '',
    firstAccessDate: record.firstAccessDate || new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    paid: false,
    admin: record.admin || false,
    fingerprint: fingerprint || 'unknown',
    ip,
    reference
  });

  res.json({
    authorization_url: data.data.authorization_url,
    reference: data.data.reference,
    amount: requestBody.amount,
    email: requestBody.email,
    phone: requestBody.phone
  });
});

app.post('/api/payments/webhook', (req, res) => {
  const event = req.body;
  const secret = process.env.PAYSTACK_SECRET || '';
  const signature = req.headers['x-paystack-signature'];

  if (secret && signature) {
    const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
    if (hash !== signature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const { event: eventType, data } = event;

  if (eventType === 'charge.success' || eventType === 'transfer.success') {
    const reference = data.reference;
    const deviceEntry = Object.entries(records.devices).find(([, record]) => record.reference === reference);
    if (deviceEntry) {
      const [deviceHash] = deviceEntry;
      updateDeviceRecord(deviceHash, { paid: true, paymentDate: new Date().toISOString() });
    }
  }

  res.status(200).json({ received: true });
});

app.post('/upload', upload.single('image'), async (req, res) => {
  const { fingerprint, email, adminKey } = req.body;
  const ip = getClientIp(req);
  const deviceHash = createDeviceHash(ip, fingerprint || 'unknown');
  const record = getDeviceRecord(deviceHash) || {};

  if (isAdmin(req)) {
    updateDeviceRecord(deviceHash, { admin: true, paid: true, email: (email || '').toLowerCase(), fingerprint: fingerprint || 'unknown', ip, firstAccessDate: record.firstAccessDate || new Date().toISOString() });
  }

  const currentRecord = getDeviceRecord(deviceHash);
  const status = trialStatusFor(currentRecord);

  if (status.state === 'expired') {
    return res.status(403).json({ error: 'Your 3-day trial has expired. Please pay to continue.' });
  }

  if (!currentRecord || !currentRecord.firstAccessDate) {
    updateDeviceRecord(deviceHash, {
      firstAccessDate: new Date().toISOString(),
      email: (email || '').toLowerCase(),
      fingerprint: fingerprint || 'unknown',
      ip,
      paid: currentRecord?.paid || false,
      admin: currentRecord?.admin || false
    });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Please upload an image file.' });
  }

  const imageUrl = `${req.protocol}://${req.get('host')}/image/${encodeURIComponent(req.file.filename)}`;
  const qrDataUrl = await QRCode.toDataURL(imageUrl, { margin: 2, width: 300 });

  updateDeviceRecord(deviceHash, { lastSeen: new Date().toISOString() });

  res.json({
    imageUrl,
    qrDataUrl,
    fileName: req.file.filename,
    status
  });
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || 'Upload failed' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
