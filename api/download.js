  import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';// Telegram WebApp initData 검증 함수
function verifyTelegramWebAppData(initData, botToken) {
  if (!initData) return null;  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');const dataCheckString = Array.from(urlParams.entries())
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => `${key}=${value}`)
  .join('\n');

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

const userStr = urlParams.get('user');
if (!userStr) return null;

return JSON.parse(userStr);  } catch (error) {
    console.error('Telegram verification error:', error);
    return null;
  }
}// 파일 접근 권한 확인
async function checkFileAccess(supabase, userId, filePath) {
  if (filePath.startsWith(${userId}/)) {
    return true;
  }  const { data, error } = await supabase
    .from('files')
    .select(      memo_id,       memos!inner(user_id, text),       shares:shares!inner(to_user_id, memo_text)    )
    .eq('storage_path', filePath)
    .eq('shares.to_user_id', userId);  if (error) {
    console.error('Access check error:', error);
    return false;
  }  return data && data.length > 0;
}export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }  try {
    // URL에서 파일 경로 파싱: /api/file?path=123/file.pdf 또는 /api/file/123/file.pdf
    let filePath;if (req.query.path) {
  // 쿼리 파라미터로 전달된 경우
  filePath = req.query.path;
} else {
  // URL 경로에서 추출: /api/file/ 이후 부분
  const urlPath = req.url.split('?')[0]; // 쿼리 스트링 제거
  const match = urlPath.match(/\/api\/file\/(.+)/);
  if (match) {
    filePath = decodeURIComponent(match[1]);
  }
}

if (!filePath) {
  return res.status(400).json({ error: 'Invalid path' });
}

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
const fileName = filePath.split('/').pop();
const buffer = Buffer.from(await data.arrayBuffer());

res.setHeader('Content-Type', data.type || 'application/octet-stream');
res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
res.setHeader('Content-Length', buffer.length);

return res.send(buffer);  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

