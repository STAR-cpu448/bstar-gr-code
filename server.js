require('dotenv').config();
const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(os.tmpdir(), 'webcode-uploads');
const recordsPath = path.join(os.tmpdir(), 'webcode-records.json');
const TRIAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

function loadRecords(){ try{ if(!fs.existsSync(recordsPath)) return { devices: {} }; return JSON.parse(fs.readFileSync(recordsPath,'utf8')); }catch(e){ return { devices: {} }; } }
function saveRecords(r){ try{ fs.writeFileSync(recordsPath, JSON.stringify(r, null, 2)); }catch(e){} }
const records = loadRecords();

function getIp(req){ const f = req.headers['x-forwarded-for']; return f? f.split(',')[0].trim() : (req.ip || req.connection.remoteAddress || 'unknown'); }
function hashDevice(ip, fingerprint){ return crypto.createHash('sha256').update(`${ip}|${fingerprint}`).digest('hex'); }

const storage = multer.diskStorage({ destination: uploadsDir, filename: (req,file,cb)=>{ cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g,'-')}`); } });
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname,'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/trial/status', (req,res)=>{
  const fingerprint = req.query.fingerprint || 'unknown'; const ip = getIp(req); const deviceHash = hashDevice(ip, fingerprint);
  const rec = records.devices[deviceHash] || null;
  if(!rec) return res.json({ state:'new', paid:false });
  if(rec.paid || rec.admin) return res.json({ state:'paid', paid:true });
  if(!rec.firstAccessDate) return res.json({ state:'new', paid:false });
  const elapsed = Date.now() - new Date(rec.firstAccessDate).getTime();
  if(elapsed <= TRIAL_MS) return res.json({ state:'trial', daysLeft: Math.ceil((TRIAL_MS - elapsed)/(24*60*60*1000)), paid:false });
  return res.json({ state:'expired', paid:false });
});

app.post('/api/trial/start', (req,res)=>{
  const { fingerprint='', email='', phone='' } = req.body; const ip = getIp(req); const deviceHash = hashDevice(ip, fingerprint);
  const rec = records.devices[deviceHash] || {};
  if(!rec.firstAccessDate) rec.firstAccessDate = new Date().toISOString();
  rec.email = email; rec.phone = phone; rec.fingerprint = fingerprint; records.devices[deviceHash] = rec; saveRecords(records);
  res.json({ state:'trial', daysLeft: 3 });
});

app.post('/api/payments/create', async (req,res)=>{
  const { fingerprint='', email='', phone='', amount=9900 } = req.body; const ip = getIp(req); const deviceHash = hashDevice(ip,fingerprint);
  const rec = records.devices[deviceHash] || {};
  if(rec.paid || rec.admin) return res.json({ paid:true, message:'already unlocked' });

  const paystackSecret = process.env.PAYSTACK_SECRET;
  const reference = `WEBCODE-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

  if(paystackSecret){
    try{
      const payload = {
        email: email || `user@webcode.local`,
        amount: amount,
        currency: 'KES',
        metadata: { deviceHash, phone },
        reference
      };
      const r = await require('node-fetch')('https://api.paystack.co/transaction/initialize', {
        method: 'POST', headers: { Authorization: `Bearer ${paystackSecret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const j = await r.json();
      if(!r.ok) return res.status(500).json({ error: j.message || 'init failed', details: j });
      rec.reference = j.data.reference || reference; records.devices[deviceHash] = rec; saveRecords(records);
      return res.json({ authorization_url: j.data.authorization_url, reference: j.data.reference });
    }catch(err){ return res.status(500).json({ error: err.message }); }
  }

  // fallback: mock url
  rec.reference = reference; records.devices[deviceHash] = rec; saveRecords(records);
  res.json({ authorization_url: `/mock-pay?ref=${reference}&device=${deviceHash}`, reference });
});

// Paystack webhook: validate signature and mark device paid
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), (req,res)=>{
  const secret = process.env.PAYSTACK_SECRET || '';
  const sig = req.headers['x-paystack-signature'];
  if(secret && sig){ const expected = crypto.createHmac('sha512', secret).update(req.body).digest('hex'); if(expected !== sig) return res.status(401).send('invalid signature'); }
  try{
    const payload = JSON.parse(req.body.toString('utf8'));
    const event = payload.event; const data = payload.data;
    if(event === 'charge.success' && data && data.reference){
      const ref = data.reference;
      const entry = Object.entries(records.devices).find(([,r]) => r.reference === ref);
      if(entry){ const [deviceHash] = entry; records.devices[deviceHash].paid = true; records.devices[deviceHash].paymentDate = new Date().toISOString(); saveRecords(records); }
    }
  }catch(e){ console.warn('webhook parse error', e.message); }
  res.status(200).send('ok');
});

app.get('/mock-pay', (req,res)=>{
  const { device, ref } = req.query; if(!device) return res.status(400).send('missing'); records.devices[String(device)] = records.devices[String(device)] || {}; records.devices[String(device)].paid = true; saveRecords(records); res.send('<p>Mock payment recorded. You can close this page.</p>');
});

app.post('/upload', upload.single('file'), async (req,res)=>{
  const fingerprint = req.body.fingerprint || 'unknown'; const ip = getIp(req); const deviceHash = hashDevice(ip,fingerprint);
  const rec = records.devices[deviceHash] || {};
  // check trial
  if(!(rec.paid || rec.admin)){
    if(!rec.firstAccessDate) return res.status(403).send('start trial first');
    const elapsed = Date.now() - new Date(rec.firstAccessDate).getTime(); if(elapsed > TRIAL_MS) return res.status(402).send('trial expired');
  }

  if(!req.file) return res.status(400).send('no file');
  const imageUrl = `${req.protocol}://${req.get('host')}/image/${encodeURIComponent(req.file.filename)}`;
  const qr = await QRCode.toDataURL(imageUrl, { width: 300 });
  res.json({ qrDataUrl: qr, imageUrl, fileName: req.file.filename });
});

app.get('/image/:name', (req,res)=>{ const file = path.join(uploadsDir, req.params.name); if(!fs.existsSync(file)) return res.status(404).send('not found'); res.sendFile(file); });

app.listen(PORT, ()=>console.log(`WEBCODE fresh app listening on ${PORT}`));
