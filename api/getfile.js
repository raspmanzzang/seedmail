import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function verifyTelegramWebAppData(initData, botToken) {
    if (!initData) return null;
    
    try {
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');
        
        const dataCheckString = Array.from(urlParams.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
        
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        
        if (calculatedHash !== hash) return null;
        
        const userStr = urlParams.get('user');
        return userStr ? JSON.parse(userStr) : null;
    } catch (error) {
        return null;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        const { path } = req.query;
        
        if (!path) {
            return res.status(400).json({ error: 'Missing path' });
        }
        
        const initData = req.headers['x-telegram-init-data'];
        const botToken = process.env.BOT_TOKEN;
        
        if (!botToken || !initData) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const telegramUser = verifyTelegramWebAppData(initData, botToken);
        if (!telegramUser) {
            return res.status(401).json({ error: 'Invalid auth' });
        }
        
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        // 권한 확인
        let hasAccess = path.startsWith(`${telegramUser.id}/`);
        
        if (!hasAccess) {
            const { data: fileData } = await supabase
                .from('files')
                .select('memo_id')
                .eq('storage_path', path)
                .single();
            
            if (fileData) {
                const { data: shareData } = await supabase
                    .from('shares')
                    .select('id')
                    .eq('memo_id', fileData.memo_id)
                    .eq('to_user_id', telegramUser.id.toString())
                    .single();
                
                hasAccess = !!shareData;
            }
        }
        
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { data, error } = await supabase.storage
            .from('memo-files')
            .download(path);
        
        if (error) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const fileName = path.split('/').pop();
        const buffer = Buffer.from(await data.arrayBuffer());
        
        res.setHeader('Content-Type', data.type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        
        return res.status(200).send(buffer);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
