import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        const { path, userId } = req.query;
        
        console.log('Download request:', { path, userId });
        
        if (!path || !userId) {
            return res.status(400).json({ 
                error: 'Missing parameters',
                debug: { path, userId }
            });
        }
        
        // Vercel 환경변수 확인
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
            console.error('Missing Supabase credentials');
            return res.status(500).json({ error: 'Server configuration error' });
        }
        
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        console.log('Supabase client created');
        
        // 권한 확인: 본인 파일이거나 공유받은 파일
        let hasAccess = path.startsWith(`${userId}/`);
        console.log('Owner check:', hasAccess);
        
        if (!hasAccess) {
            console.log('Checking share permissions...');
            
            const { data: fileData, error: fileError } = await supabase
                .from('files')
                .select('memo_id')
                .eq('storage_path', path)
                .single();
            
            if (fileError) {
                console.error('File lookup error:', fileError);
                return res.status(404).json({ error: 'File not found in database' });
            }
            
            console.log('File memo_id:', fileData.memo_id);
            
            const { data: shareData, error: shareError } = await supabase
                .from('shares')
                .select('id')
                .eq('memo_id', fileData.memo_id)
                .eq('to_user_id', userId);
            
            if (shareError) {
                console.error('Share check error:', shareError);
            }
            
            console.log('Share data:', shareData);
            hasAccess = shareData && shareData.length > 0;
        }
        
        if (!hasAccess) {
            console.error('Access denied for user:', userId);
            return res.status(403).json({ error: 'Access denied' });
        }
        
        console.log('Access granted, downloading file...');
        
        // 파일 다운로드
        const { data, error } = await supabase.storage
            .from('memo-files')
            .download(path);
        
        if (error) {
            console.error('Download error:', error);
            return res.status(404).json({ error: 'File not found in storage' });
        }
        
        const fileName = path.split('/').pop();
        const buffer = Buffer.from(await data.arrayBuffer());
        
        console.log('File downloaded successfully:', fileName);
        
        res.setHeader('Content-Type', data.type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        
        return res.status(200).send(buffer);
    } catch (error) {
        console.error('API error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
}
