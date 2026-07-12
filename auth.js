// api/auth.js — OAuth2 callback от DonationAlerts
//
// БАГИ (найдены и исправлены):
// 1. В самом начале файла был мусорный текст "uth · JS" перед реальным
//    кодом — судя по всему, обрывок скопированной подписи файла из какого-то
//    редактора/просмотрщика. node --check валил SyntaxError на первой же
//    строке: файл был НЕВАЛИДНЫМ JS и не мог выполниться вообще, ни разу.
//    Это, скорее всего, главная причина, почему авторизация не работала —
//    остальное могло быть исправно, а вызвать всё равно было нечего.
// 2. Тело запроса на обмен кода на токен отправлялось как JSON
//    (Content-Type: application/json) — а по официальной документации
//    DonationAlerts (donationalerts.com/apidoc, "Getting Access Token")
//    этот эндпоинт ждёт application/x-www-form-urlencoded. Поменял на
//    URLSearchParams, как в примере curl из их же доков.
export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error) return res.redirect('/?da_error=' + encodeURIComponent(error));
  if (!code)  return res.status(400).json({ error: 'No code' });

  try {
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     process.env.DA_CLIENT_ID,     // 19366
      client_secret: process.env.DA_CLIENT_SECRET, // из страницы «Изменить»
      redirect_uri:  'https://dan4ik37.vercel.app/api/auth',
      code,
    });
    const r = await fetch('https://www.donationalerts.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
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
