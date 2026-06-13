uth · JS
// api/auth.js — OAuth2 callback от DonationAlerts
export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error) return res.redirect('/?da_error=' + encodeURIComponent(error));
  if (!code)  return res.status(400).json({ error: 'No code' });
 
  try {
    const r = await fetch('https://www.donationalerts.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type:    'authorization_code',
        client_id:     process.env.DA_CLIENT_ID,     // 19366
        client_secret: process.env.DA_CLIENT_SECRET, // из страницы «Изменить»
        redirect_uri:  'https://dan4ik37.vercel.app/api/auth',
        code,
      }),
    });
    const t = await r.json();
    if (!t.access_token) throw new Error(JSON.stringify(t));
 
    res.setHeader('Set-Cookie', [
      `da_token=${t.access_token}; HttpOnly; Secure; SameSite=Lax; Max-Age=86400; Path=/`,
      `da_refresh=${t.refresh_token||''}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/`,
    ]);
    res.redirect('/?da_auth=success');
  } catch(e) {
    console.error(e);
    res.redirect('/?da_error=auth_failed');
  }
}
 
