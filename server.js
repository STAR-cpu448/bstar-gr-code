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
const TRIAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

function loadRecords() {
  try {
    if (!fs.existsSync(recordsPath)) return { devices: {} };
    return JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
  } catch (err) {
    console.warn('Could not read records:', err.message);
    return { devices: {} };
  }
}

function saveRecords(recs) {
  try { fs.writeFileSync(recordsPath, JSON.stringify(recs, null, 2)); } catch (e) { console.warn('Save failed', e.message); }
}

const records = loadRecords();

function ensureUploadsDir(){ if(!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); }
ensureUploadsDir();

const storage = multer.diskStorage({ destination: uploadsDir, filename: (req,file,cb)=>{
  const safe = file.originalname.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9._-]/g,'');
  cb(null, `${Date.now()}-${safe}`);
}});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req,file,cb)=>{
  if(!file.mimetype.startsWith('image/')) return cb(new Error('only images'));
  cb(null,true);
}});

app.use(express.static(path.join(__dirname,'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function getClientIp(req){ const f = req.headers['x-forwarded-for']; return f? f.split(',')[0].trim() : (req.ip || req.connection.remoteAddress || 'unknown'); }
function createDeviceHash(ip, fingerprint){ return crypto.createHash('sha256').update(`${ip}|${fingerprint}`).digest('hex'); }
function getDevice(deviceHash){ return records.devices[deviceHash]; }
function updateDevice(deviceHash, patch){ const curr = getDevice(deviceHash) || {}; records.devices[deviceHash] = { ...curr, ...patch }; saveRecords(records); return records.devices[deviceHash]; }
function trialStatusFor(rec){ if(!rec) return { state:'new', daysLeft:0 }; if(rec.admin||rec.paid) return { state:'paid', daysLeft:0 }; if(!rec.firstAccessDate) return { state:'new', daysLeft:0 }; const elapsed = Date.now() - new Date(rec.firstAccessDate).getTime(); if(elapsed <= TRIAL_MS) return { state:'trial', daysLeft: Math.ceil((TRIAL_MS - elapsed)/(24*60*60*1000)) }; return { state:'expired', daysLeft:0 } }

function isAdminBypass(req){ const email = (req.body.email||req.query.email||'').toLowerCase(); const adminEmail = process.env.ADMIN_EMAIL; const bypassKey = process.env.ADMIN_BYPASS_KEY; const providedKey = req.body.adminKey || req.query.adminKey || req.headers['x-admin-key'] || ''; return (!!adminEmail && email === adminEmail.toLowerCase()) || (!!bypassKey && providedKey === bypassKey); }

app.get('/api/trial/status', (req,res)=>{
  const fingerprint = req.query.fingerprint || 'unknown'; const email = (req.query.email||'').toLowerCase(); const phone = req.query.phone||''; const ip = getClientIp(req); const deviceHash = createDeviceHash(ip, fingerprint); const rec = getDevice(deviceHash);
  if(rec){ const s = trialStatusFor(rec); return res.json({ state:s.state, daysLeft:s.daysLeft, paid: !!rec.paid, admin: !!rec.admin, email: rec.email||email, phone: rec.phone||phone }); }
  // admin auto-unlock if env set
  if( (!!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase()) || (!!process.env.ADMIN_BYPASS_KEY && (req.query.adminKey === process.env.ADMIN_BYPASS_KEY || req.headers['x-admin-key'] === process.env.ADMIN_BYPASS_KEY)) ){
    updateDevice(deviceHash, { admin:true, paid:true, firstAccessDate: new Date().toISOString(), email, phone });
    return res.json({ state:'paid', daysLeft:0, paid:true, admin:true, email, phone });
  }
  return res.json({ state:'new', daysLeft:0, paid:false, admin:false, email, phone });
});

app.post('/api/trial/start', (req,res)=>{
  const { fingerprint='', email='', phone='' } = req.body; const ip = getClientIp(req); const deviceHash = createDeviceHash(ip, fingerprint); if(isAdminBypass(req)){ updateDevice(deviceHash, { admin:true, paid:true, firstAccessDate: new Date().toISOString(), email: (email||'').toLowerCase(), phone }); return res.json({ state:'paid', daysLeft:0, paid:true, admin:true }); }
  const rec = getDevice(deviceHash) || {}; if(!rec.firstAccessDate){ updateDevice(deviceHash, { firstAccessDate: new Date().toISOString(), email: (email||'').toLowerCase(), phone, fingerprint, ip, paid:false, admin:false }); }
  const updated = getDevice(deviceHash); const s = trialStatusFor(updated); return res.json({ state: s.state, daysLeft: s.daysLeft, paid: !!updated.paid });
});

// payment initialization (Paystack optional)
app.post('/api/payments/create', async (req,res)=>{
  const { fingerprint='', email='', phone='', amount=9900 } = req.body; const ip = getClientIp(req); const deviceHash = createDeviceHash(ip, fingerprint); const rec = getDevice(deviceHash) || {};
  if(rec.paid || rec.admin) return res.json({ paid:true, message:'already unlocked' });

  const paystackSecret = process.env.PAYSTACK_SECRET;
  const reference = `WEBCODE-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

  if(paystackSecret){
    try{
      const payload = { email: email||`user@webcode.local`, amount, metadata:{ deviceHash, phone }, reference };
      const r = await fetch('https://api.paystack.co/transaction/initialize', { method:'POST', headers: { Authorization: `Bearer ${paystackSecret}`, 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if(!r.ok) return res.status(500).json({ error: j.message || 'init failed', details:j });
      updateDevice(deviceHash, { email:(email||'').toLowerCase(), phone, reference, paid:false, firstAccessDate: rec.firstAccessDate || new Date().toISOString() });
      return res.json({ authorization_url: j.data.authorization_url, reference: j.data.reference });
    }catch(err){ return res.status(500).json({ error: err.message }); }
  }

  // fallback: return a mock URL so devs can test without keys
  updateDevice(deviceHash, { email:(email||'').toLowerCase(), phone, reference, paid:false, firstAccessDate: rec.firstAccessDate || new Date().toISOString() });
  return res.json({ authorization_url: `/mock-pay?ref=${encodeURIComponent(reference)}&device=${encodeURIComponent(deviceHash)}`, reference });
});

// Paystack webhook (expects raw body to validate signature)
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), (req,res)=>{
  const secret = process.env.PAYSTACK_SECRET || ''; const sig = req.headers['x-paystack-signature'];
  if(secret && sig){ const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex'); if(hash !== sig) return res.status(401).send('invalid signature'); }
  try{
    const payload = JSON.parse(req.body.toString('utf8'));
    const event = payload.event; const data = payload.data;
    if(event === 'charge.success' && data && data.reference){
      const ref = data.reference; const entry = Object.entries(records.devices).find(([,r]) => r.reference === ref);
      if(entry){ const [deviceHash] = entry; updateDevice(deviceHash, { paid:true, paymentDate: new Date().toISOString() }); }
    }
  }catch(e){ console.warn('webhook parse', e.message); }
  res.status(200).send('ok');
});

// mock pay route for local testing
app.get('/mock-pay', (req,res)=>{
  const { ref, device } = req.query; if(!ref || !device) return res.status(400).send('missing'); updateDevice(String(device), { paid:true, paymentDate: new Date().toISOString() }); res.send(`<html><body><h3>Mock payment complete</h3><p>ref=${ref}</p><p>device=${device}</p><p><a href="/">Return</a></p></body></html>`);
});

// serve uploaded images
app.get('/image/:name', (req,res)=>{ const file = path.join(uploadsDir, req.params.name); if(!fs.existsSync(file)) return res.status(404).send('not found'); res.sendFile(file); });

// upload endpoint
app.post('/upload', upload.single('file'), async (req,res,next)=>{
  try{
    const fingerprint = req.body.fingerprint || 'unknown'; const email = (req.body.email||'').toLowerCase(); const ip = getClientIp(req); const deviceHash = createDeviceHash(ip, fingerprint); if(isAdminBypass(req)) updateDevice(deviceHash, { admin:true, paid:true, firstAccessDate: new Date().toISOString(), email, fingerprint, ip });
    const rec = getDevice(deviceHash) || {};
    const status = trialStatusFor(rec);
    if(status.state === 'expired' && !rec.paid && !rec.admin) return res.status(402).send('trial expired');
    if(!req.file) return res.status(400).send('no file');
    const imageUrl = `${req.protocol}://${req.get('host')}/image/${encodeURIComponent(req.file.filename)}`;
    const qrDataUrl = await QRCode.toDataURL(imageUrl, { margin:2, width:300 });
    updateDevice(deviceHash, { lastSeen: new Date().toISOString() });
    return res.json({ imageUrl, qrDataUrl, fileName: req.file.filename, status });
  }catch(err){ next(err); }
});

app.use((err,req,res,next)=>{ console.error('err', err && err.message); res.status(500).json({ error: err && err.message || 'server error' }); });

app.listen(PORT, ()=>{ console.log(`WebCode listening on ${PORT}`); });

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
