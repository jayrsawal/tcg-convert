import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 8080;
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_HOSTS.length === 0 || ALLOWED_HOSTS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
  })
);

app.use(morgan('tiny'));

app.get('/image-proxy', async (req, res) => {
  try {
    const targetParam = req.query.url;
    if (!targetParam) {
      res.status(400).json({ error: 'Missing url parameter' });
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetParam);
    } catch (err) {
      res.status(400).json({ error: 'Invalid URL provided' });
      return;
    }

    if (!['https:', 'http:'].includes(targetUrl.protocol)) {
      res.status(400).json({ error: 'Unsupported protocol' });
      return;
    }

    const upstreamResponse = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'StrikerPackImageProxy/1.0',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (!upstreamResponse.ok) {
      res.status(upstreamResponse.status).json({ error: 'Failed to fetch upstream image' });
      return;
    }

    const contentType = upstreamResponse.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const arrayBuffer = await upstreamResponse.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('[image-proxy] Error fetching image:', err);
    res.status(500).json({ error: 'Internal proxy error' });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'StrikerPack image proxy is running',
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Image proxy listening on port ${PORT}`);
});

