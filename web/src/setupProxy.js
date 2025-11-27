const { URL } = require('node:url');

module.exports = function setupProxy(app) {
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
          'User-Agent': 'DeckBuilderImageProxy/1.0',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        }
      });

      if (!upstreamResponse.ok) {
        res.status(upstreamResponse.status).json({ error: 'Failed to fetch upstream image' });
        return;
      }

      const contentType = upstreamResponse.headers.get('content-type') || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const arrayBuffer = await upstreamResponse.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (err) {
      console.error('[image-proxy] Error fetching image:', err);
      res.status(500).json({ error: 'Internal proxy error' });
    }
  });
};

