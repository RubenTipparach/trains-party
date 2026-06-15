/**
 * Admin portal (/admin), modeled on the High Frontier admin dashboard. Gated by
 * an allowlist (ADMIN_DISCORD_ID, seeded into server_settings on boot and
 * re-checked every request). Identify-only Discord sign-in, hashed cookie session.
 * Lets an operator edit the announcement banner and close stale rooms.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, getSetting, setSetting } from './db';
import { CFG } from './config';
import { buildAuthorizeUrl, exchangeCode, fetchUser } from './discord';
import {
  ADMIN_COOKIE,
  isAdminId,
  createAdminSession,
  adminFromCookie,
  deleteAdminSession,
  upsertProfile,
  profileName
} from './auth';
import { makeState, takeState } from './oauth';
import type { RoomRow } from './engine';

const reqOrigin = (req: FastifyRequest) =>
  `${(req.headers['x-forwarded-proto'] as string) || req.protocol || 'https'}://${req.headers.host}`;
const adminCallback = (req: FastifyRequest) => `${reqOrigin(req)}/admin/callback`;

function requireAdmin(req: FastifyRequest, reply: FastifyReply): string | null {
  const id = adminFromCookie((req.cookies as Record<string, string>)?.[ADMIN_COOKIE]);
  if (!id) {
    reply.code(403).send({ error: 'admin_auth_required' });
    return null;
  }
  return id;
}

export function registerAdmin(app: FastifyInstance): void {
  // Public announcement banner (the frontend lobby reads this).
  app.get('/announcement', async () => ({
    message: getSetting('announcement') ?? '',
    updatedAt:
      (db.prepare("SELECT updated_at AS u FROM server_settings WHERE key = 'announcement'").get() as
        | { u: number }
        | undefined)?.u ?? 0
  }));

  app.get('/admin/login', async (req, reply) => {
    if (!CFG.discord.signIn) return reply.code(404).send({ error: 'discord_disabled' });
    const state = makeState('admin', '');
    return reply.redirect(buildAuthorizeUrl(state, adminCallback(req), ['identify']));
  });

  app.get('/admin/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return reply.code(400).send({ error: 'missing_code' });
    if (!takeState(state, 'admin')) return reply.code(400).send({ error: 'bad_state' });
    const token = await exchangeCode(code, adminCallback(req));
    if (!token) return reply.code(502).send({ error: 'token_exchange_failed' });
    const user = await fetchUser(token);
    if (!user) return reply.code(502).send({ error: 'identify_failed' });
    if (!isAdminId(user.id)) {
      return reply.code(403).type('text/html').send('<h1>Not authorized</h1><p>This Discord account is not on the admin allowlist.</p>');
    }
    upsertProfile(user);
    const raw = createAdminSession(user.id);
    reply.setCookie(ADMIN_COOKIE, raw, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/admin',
      maxAge: Math.floor(CFG.adminTtlMs / 1000)
    });
    return reply.redirect('/admin');
  });

  app.post('/admin/logout', async (req, reply) => {
    deleteAdminSession((req.cookies as Record<string, string>)?.[ADMIN_COOKIE]);
    reply.clearCookie(ADMIN_COOKIE, { path: '/admin' });
    return { ok: true };
  });

  app.get('/admin/me', async (req, reply) => {
    const id = adminFromCookie((req.cookies as Record<string, string>)?.[ADMIN_COOKIE]);
    if (!id) return reply.code(401).send({ error: 'not_admin' });
    return { discordId: id, name: profileName(id) };
  });

  app.post('/admin/announcement', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const message = String((req.body as { message?: string })?.message ?? '').slice(0, 2000);
    setSetting('announcement', message);
    return { ok: true, message };
  });

  app.get('/admin/rooms', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rooms = db.prepare('SELECT * FROM rooms ORDER BY updated_at DESC, created_at DESC LIMIT 200').all() as RoomRow[];
    return rooms.map((r) => ({
      code: r.code,
      title: r.title,
      status: r.status,
      seq: r.seq,
      seats: (db.prepare('SELECT COUNT(*) AS n FROM room_seats WHERE room_code = ?').get(r.code) as { n: number }).n,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  });

  app.post('/admin/rooms/:code/close', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    db.prepare('DELETE FROM rooms WHERE code = ?').run((req.params as { code: string }).code);
    return { ok: true };
  });

  app.get('/admin', async (_req, reply) => reply.type('text/html').send(ADMIN_HTML));
}

const ADMIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trains Party - Admin</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#0b2233;color:#e8eef4}
  header{background:#102a3a;padding:16px 22px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1d3a4d}
  h1{font-size:18px;margin:0}main{max-width:820px;margin:0 auto;padding:22px}
  section{background:#102a3a;border:1px solid #1d3a4d;border-radius:10px;padding:18px;margin:0 0 18px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#9fb6c6;margin:0 0 12px}
  textarea{width:100%;box-sizing:border-box;min-height:80px;background:#0b1f2c;color:#e8eef4;border:1px solid #28465a;border-radius:8px;padding:10px;font:inherit}
  button{background:#e0392b;color:#fff;border:0;border-radius:8px;padding:9px 16px;font:inherit;cursor:pointer}
  button.ghost{background:#27465a}a{color:#7fd1ff}
  table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:7px 8px;border-bottom:1px solid #1d3a4d}
  .muted{color:#9fb6c6}.signin{text-align:center;padding:40px}
</style></head><body>
<header><h1>🚂 Trains Party - Admin</h1><span id="who" class="muted"></span></header>
<main id="app"><p class="muted">Loading...</p></main>
<script>
const app = document.getElementById('app'), who = document.getElementById('who');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function j(url, opts){ const r = await fetch(url, Object.assign({headers:{'Content-Type':'application/json'}}, opts)); return r.ok ? r.json() : Promise.reject(r); }
async function load(){
  let me; try { me = await j('/admin/me'); } catch { return signedOut(); }
  who.textContent = '@' + me.name;
  const ann = await j('/announcement').catch(()=>({message:''}));
  const rooms = await j('/admin/rooms').catch(()=>[]);
  app.innerHTML = \`
   <section><h2>Announcement banner</h2>
     <textarea id="ann">\${esc(ann.message||'')}</textarea>
     <div style="margin-top:10px"><button id="saveAnn">Save banner</button> <span id="annMsg" class="muted"></span></div>
   </section>
   <section><h2>Rooms (\${rooms.length})</h2>
     <table><thead><tr><th>Code</th><th>Title</th><th>Status</th><th>Seats</th><th>Moves</th><th></th></tr></thead><tbody>
     \${rooms.map(r=>\`<tr><td>\${esc(r.code)}</td><td>\${esc(r.title)}</td><td>\${esc(r.status)}</td><td>\${r.seats}</td><td>\${r.seq}</td>
       <td><button class="ghost close" data-code="\${esc(r.code)}">Close</button></td></tr>\`).join('') || '<tr><td colspan=6 class="muted">No rooms.</td></tr>'}
     </tbody></table>
   </section>
   <section><button class="ghost" id="logout">Sign out</button></section>\`;
  document.getElementById('saveAnn').onclick = async () => {
    await j('/admin/announcement',{method:'POST',body:JSON.stringify({message:document.getElementById('ann').value})});
    document.getElementById('annMsg').textContent = 'Saved.';
  };
  document.querySelectorAll('.close').forEach(b => b.onclick = async () => {
    if(!confirm('Close room '+b.dataset.code+'?'))return;
    await j('/admin/rooms/'+b.dataset.code+'/close',{method:'POST'}); load();
  });
  document.getElementById('logout').onclick = async () => { await j('/admin/logout',{method:'POST'}); signedOut(); };
}
function signedOut(){ who.textContent=''; app.innerHTML = '<div class="signin"><p>Admin access requires Discord sign-in.</p><p><a href="/admin/login"><button>Sign in with Discord</button></a></p></div>'; }
load();
</script></body></html>`;
