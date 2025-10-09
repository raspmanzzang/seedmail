import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
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
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vgtepvkiqpcbwwernsdc.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZndGVwdmtpcXBjYnd3ZXJuc2RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5MTE3NDcsImV4cCI6MjA3NTQ4Nzc0N30.mDwMikzbs1etS4QMDuprpEVgLLZYlbjXKibQ6EZslXI';

  if (!BOT_TOKEN) {
    res.status(500).json({ error: 'Bot token not configured' });
    return;
  }

  try {
    const { chat_id, text, document, disable_web_page_preview, local_time, timezone, from_user_id, to_user_id, to_username, memo_text, memo_time } = req.body;

    // 로컬 시간 처리
    const sent_at = local_time ? new Date(local_time).toISOString() : new Date().toISOString();
    console.log('Received local_time:', local_time, 'Timezone:', timezone, 'Stored sent_at:', sent_at);

    // Supabase 클라이언트 초기화
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Supabase에 메시지 저장
    if (!document && chat_id && memo_text) {
      const { error: dbError } = await supabase
        .from('shares')
        .insert({
          from_user_id,
          to_user_id,
          to_username,
          memo_text,
          memo_time,
          sent_at,
          timezone // 시간대 저장
        });

      if (dbError) {
        console.error('Supabase insert error:', dbError);
        res.status(500).json({ error: 'Failed to save to database', details: dbError.message });
        return;
      }
    }

    // Telegram API 호출
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
