import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        const { path, userId } = req.query;
        
        if (!path || !userId) {
            return res.status(400).json({ error: 'Missing parameters' });
        }
        
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        // 권한 확인: 본인 파일이거나 공유받은 파일
        let hasAccess = path.startsWith(`${userId}/`);
        
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
                    .eq('to_user_id', userId)
                    .single();
                
                hasAccess = !!shareData;
            }
        }
        
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // 파일 다운로드
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
