import fetch from 'node-fetch';

export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  
  if (!BOT_TOKEN) {
    res.status(500).json({ error: 'Bot token not configured' });
    return;
  }

  try {
    const { chat_id, text, document, disable_web_page_preview, local_time, timezone } = req.body;

    // 클라이언트에서 보낸 로컬 시간 확인
    const sent_at = local_time ? new Date(local_time).toISOString() : new Date().toISOString();
    console.log('Received local_time:', local_time, 'Timezone:', timezone, 'Stored sent_at:', sent_at);

    const telegramUrl = document 
      ? `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`
      : `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': document ? 'multipart/form-data' : 'application/json' },
      body: document ? req.body.document : JSON.stringify({
        chat_id,
        text,
        disable_web_page_preview
      })
    });

    const data = await response.json();
    
    // Supabase에 저장 시 sent_at과 timezone 포함
    if (data.ok) {
      res.status(200).json({ ...data, sent_at, timezone });
    } else {
      res.status(500).json({ error: 'Telegram API failed', details: data });
    }

  } catch (error) {
    console.error('Telegram API error:', error);
    res.status(500).json({ 
      error: 'Failed to send message',
      details: error.message 
    });
  }
}
