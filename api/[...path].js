import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function verifyTelegramWebAppData(initData, botToken) {
    if (!initData) {
        console.error('No initData provided');
        return null;
    }
    
    try {
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');
        
        const dataCheckString = Array.from(urlParams.entries())
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
            console.error('Invalid hash: calculated:', calculatedHash, 'received:', hash);
            return null;
        }
        
        const userStr = urlParams.get('user');
        if (!userStr) {
            console.error('No user data in initData');
            return null;
        }
        return JSON.parse(userStr);
    } catch (error) {
        console.error('Telegram verification error:', error);
        return null;
    }
}

async function checkFileAccess(supabase, userId, filePath) {
    console.log('Checking access for user:', userId, 'file:', filePath);
    
    // 1. 본인이 업로드한 파일
    if (filePath.startsWith(`${userId}/`)) {
        console.log('Access granted: File belongs to user');
        return true;
    }
    
    // 2. 파일의 memo_id 조회
    const { data: fileData, error: fileError } = await supabase
        .from('files')
        .select('memo_id')
        .eq('storage_path', filePath)
        .single();
    
    if (fileError || !fileData) {
        console.error('File not found in files table:', fileError?.message);
        return false;
    }
    
    console.log('File memo_id:', fileData.memo_id);
    
    // 3. shares 테이블에서 권한 확인
    const { data: shareData, error: shareError } = await supabase
        .from('shares')
        .select('id')
        .eq('memo_id', fileData.memo_id)
        .eq('to_user_id', userId.toString());
    
    if (shareError) {
        console.error('Share check error:', shareError.message);
        return false;
    }
    
    console.log('Share check result:', shareData);
    return shareData && shareData.length > 0;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-Telegram-Init-Data');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const pathArray = req.query.path || [];
        console.log('Raw pathArray:', pathArray);
        
        // pathArray는 이미 파일 경로만 포함 (예: ['6938072320', '1760083679850_unnamed.png'])
        const filePath = decodeURIComponent(pathArray.join('/'));
        
        console.log('Parsed filePath:', filePath);
        
        if (!filePath || !filePath.includes('/')) {
            console.error('Invalid file path:', filePath);
            return res.status(400).json({ 
                error: 'Invalid file path', 
                debug: { pathArray, filePath } 
            });
        }
        
        const initData = req.headers['x-telegram-init-data'];
        console.log('initData received:', !!initData);
        
        if (!initData) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Missing Telegram initData'
            });
        }
        
        const botToken = process.env.BOT_TOKEN;
        if (!botToken) {
            console.error('Missing BOT_TOKEN');
            return res.status(500).json({ error: 'Server configuration error' });
        }
        
        const telegramUser = verifyTelegramWebAppData(initData, botToken);
        if (!telegramUser) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Invalid Telegram initData. Please open this link in SeedNote Telegram bot'
            });
        }
        
        console.log('User ID:', telegramUser.id);
        
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        // 파일 존재 여부 확인
        const { data: fileExists, error: fileError } = await supabase
            .from('files')
            .select('storage_path, memo_id')
            .eq('storage_path', filePath)
            .single();
        
        if (fileError || !fileExists) {
            console.error('File not found in files table:', filePath, fileError?.message);
            return res.status(404).json({ 
                error: 'File not found in database', 
                details: fileError?.message 
            });
        }
        
        const hasAccess = await checkFileAccess(supabase, telegramUser.id, filePath);
        if (!hasAccess) {
            console.error('Access denied for user:', telegramUser.id, 'file:', filePath);
            return res.status(403).json({ 
                error: 'Forbidden',
                message: 'You do not have permission to access this file'
            });
        }
        
        const { data, error } = await supabase.storage
            .from('memo-files')
            .download(filePath);
        
        if (error) {
            console.error('Download error:', error.message);
            return res.status(404).json({ 
                error: 'File not found in storage',
                details: error.message 
            });
        }
        
        const fileName = filePath.split('/').pop();
        const buffer = Buffer.from(await data.arrayBuffer());
        
        res.setHeader('Content-Type', data.type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Length', buffer.length);
        
        return res.status(200).send(buffer);
    } catch (error) {
        console.error('API error:', error.message);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
}
