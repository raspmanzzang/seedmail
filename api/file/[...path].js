import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Telegram WebApp initData 검증 함수
function verifyTelegramWebAppData(initData, botToken) {
  if (!initData) return null;

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    // 파라미터를 알파벳 순으로 정렬
    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // HMAC-SHA256으로 검증
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return null;
    }

    // user 정보 파싱
    const userStr = urlParams.get('user');
    if (!userStr) return null;

    return JSON.parse(userStr);
  } catch (error) {
    console.error('Telegram verification error:', error);
    return null;
  }
}

// 파일 접근 권한 확인
async function checkFileAccess(supabase, userId, filePath) {
  // 1. 본인이 업로드한 파일인지 확인
  if (filePath.startsWith(`${userId}/`)) {
    return true;
  }

  // 2. 공유받은 파일인지 확인
  const { data, error } = await supabase
    .from('files')
    .select(`
      memo_id,
      memos!inner(user_id, text),
      shares:shares!inner(to_user_id, memo_text)
    `)
    .eq('storage_path', filePath)
    .eq('shares.to_user_id', userId);

  if (error) {
    console.error('Access check error:', error);
    return false;
  }

  return data && data.length > 0;
}

export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { path } = req.query;
    if (!path || path.length === 0) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const filePath = path.join('/');

    // 1. Telegram 인증 확인
    const initData = req.headers['x-telegram-init-data'] || req.query.initData;
    const botToken = process.env.BOT_TOKEN;

    if (!botToken) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const telegramUser = verifyTelegramWebAppData(initData, botToken);
    
    if (!telegramUser) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Please open this link in SeedNote Telegram bot'
      });
    }

    // 2. Supabase 연결
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // 3. 파일 접근 권한 확인
    const hasAccess = await checkFileAccess(supabase, telegramUser.id, filePath);
    
    if (!hasAccess) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'You do not have permission to access this file'
      });
    }

    // 4. 파일 다운로드
    const { data, error } = await supabase.storage
      .from('memo-files')
      .download(filePath);

    if (error) {
      console.error('Download error:', error);
      return res.status(404).json({ error: 'File not found' });
    }

    // 5. 파일 전송
    const fileName = path[path.length - 1];
    const buffer = Buffer.from(await data.arrayBuffer());

    res.setHeader('Content-Type', data.type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', buffer.length);
    
    return res.send(buffer);

  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
