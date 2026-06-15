/**
 * Admin portal (/admin), modeled on the High Frontier admin dashboard. Gated by
 * an allowlist (ADMIN_DISCORD_ID, seeded into server_settings on boot and
 * re-checked every request). Identify-only Discord sign-in, hashed cookie session.
 * Lets an operator edit the announcement banner and close stale rooms.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, getSetting, setSetting } from './db';
import { CFG } from './config';
import { buildAuthorizeUrl } from './discord';
import { ADMIN_COOKIE, adminFromCookie, deleteAdminSession, profileName } from './auth';
import { makeState, discordCallback } from './oauth';
import type { RoomRow } from './engine';

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

  // Admin sign-in reuses the shared Discord callback (same registered redirect
  // URI as players). The callback checks the ADMIN_DISCORD_ID allowlist for an
  // 'admin'-kind state and only then mints the admin cookie.
  app.get('/admin/login', async (req, reply) => {
    if (!CFG.discord.signIn) return reply.code(404).send({ error: 'discord_disabled' });
    const state = makeState('admin', '');
    return reply.redirect(buildAuthorizeUrl(state, discordCallback(req), ['identify']));
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

  // Everyone who has signed in (Discord or guest), with an active-session flag.
  app.get('/admin/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = db
      .prepare(
        `SELECT p.discord_id, p.username, p.display_name, p.created_at, p.updated_at,
           (SELECT COUNT(*) FROM sessions s WHERE s.discord_id = p.discord_id AND s.expires_at > ?) AS active
         FROM profiles p ORDER BY p.updated_at DESC LIMIT 200`
      )
      .all(Date.now()) as {
      discord_id: string;
      username: string;
      display_name: string | null;
      created_at: number;
      updated_at: number;
      active: number;
    }[];
    return rows.map((r) => ({
      discordId: r.discord_id,
      name: r.display_name || r.username,
      guest: !/^\d+$/.test(r.discord_id),
      active: r.active > 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  });

  // Latest 50 lobby chat messages, with moderation (delete).
  app.get('/admin/chat', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = db
      .prepare('SELECT id, discord_id, name, body, created_at FROM lobby_chat ORDER BY id DESC LIMIT 50')
      .all() as { id: number; discord_id: string | null; name: string; body: string; created_at: number }[];
    return rows.map((r) => ({ id: r.id, discordId: r.discord_id, name: r.name, body: r.body, at: r.created_at }));
  });

  app.post('/admin/chat/:id/delete', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    db.prepare('DELETE FROM lobby_chat WHERE id = ?').run(Number((req.params as { id: string }).id));
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
  h1{font-size:18px;margin:0}main{max-width:860px;margin:0 auto;padding:22px}
  section{background:#102a3a;border:1px solid #1d3a4d;border-radius:10px;padding:18px;margin:0 0 18px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#9fb6c6;margin:0 0 12px}
  textarea{width:100%;box-sizing:border-box;min-height:80px;background:#0b1f2c;color:#e8eef4;border:1px solid #28465a;border-radius:8px;padding:10px;font:inherit}
  button{background:#e0392b;color:#fff;border:0;border-radius:8px;padding:9px 16px;font:inherit;cursor:pointer}
  button.ghost{background:#27465a}button.sm{padding:4px 10px;font-size:13px}a{color:#7fd1ff}
  table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:7px 8px;border-bottom:1px solid #1d3a4d;vertical-align:top}
  .muted{color:#9fb6c6}.signin{text-align:center;padding:40px}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#3a5566}
  .dot.on{background:#3fbf6f}
  .tag{font-size:11px;border:1px solid #2c4a5e;border-radius:999px;padding:1px 7px;color:#9fb6c6}
  .mono{font:12px ui-monospace,monospace;color:#9fb6c6}
  .chat .row{display:flex;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px solid #16303f}
  .chat .nm{font-weight:700;color:#ffd23f}.chat .bd{flex:1}.chat .tm{color:#6f8aa0;font-size:12px}
</style></head><body>
<header><h1>🚂 Trains Party - Admin</h1><span id="who" class="muted"></span></header>
<main id="app"><p class="muted">Loading...</p></main>
<script>
const app = document.getElementById('app'), who = document.getElementById('who');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function j(url, opts){ const r = await fetch(url, Object.assign({headers:{'Content-Type':'application/json'}}, opts)); return r.ok ? r.json() : Promise.reject(r); }
const when = t => t ? new Date(t).toLocaleString() : '';
const time = t => t ? new Date(t).toLocaleTimeString() : '';
async function load(){
  let me; try { me = await j('/admin/me'); } catch { return signedOut(); }
  who.textContent = '@' + me.name;
  const [ann, rooms, users, chat] = await Promise.all([
    j('/announcement').catch(()=>({message:''})),
    j('/admin/rooms').catch(()=>[]),
    j('/admin/users').catch(()=>[]),
    j('/admin/chat').catch(()=>[])
  ]);
  app.innerHTML = \`
   <section><h2>Announcement banner</h2>
     <textarea id="ann">\${esc(ann.message||'')}</textarea>
     <div style="margin-top:10px"><button id="saveAnn">Save banner</button> <span id="annMsg" class="muted"></span></div>
   </section>

   <section><h2>Users (\${users.length})</h2>
     <table><thead><tr><th></th><th>Name</th><th>Type</th><th>ID</th><th>Joined</th></tr></thead><tbody>
     \${users.map(u=>\`<tr><td><span class="dot \${u.active?'on':''}" title="\${u.active?'active session':'no active session'}"></span></td>
       <td>\${esc(u.name)}</td><td><span class="tag">\${u.guest?'Guest':'Discord'}</span></td>
       <td class="mono">\${esc(u.discordId)}</td><td class="muted">\${when(u.createdAt)}</td></tr>\`).join('') || '<tr><td colspan=5 class="muted">No users yet.</td></tr>'}
     </tbody></table>
     <p class="muted" style="margin:8px 0 0;font-size:12px">Green dot = currently has an active session.</p>
   </section>

   <section class="chat"><h2>Lobby chat (latest \${chat.length})</h2>
     \${chat.map(c=>\`<div class="row"><span class="nm">\${esc(c.name)}</span><span class="bd">\${esc(c.body)}</span>
       <span class="tm">\${time(c.at)}</span><button class="ghost sm delchat" data-id="\${c.id}">Delete</button></div>\`).join('') || '<p class="muted">No messages.</p>'}
   </section>

   <section><h2>Rooms (\${rooms.length})</h2>
     <table><thead><tr><th>Code</th><th>Title</th><th>Status</th><th>Seats</th><th>Moves</th><th></th></tr></thead><tbody>
     \${rooms.map(r=>\`<tr><td class="mono">\${esc(r.code)}</td><td>\${esc(r.title)}</td><td>\${esc(r.status)}</td><td>\${r.seats}</td><td>\${r.seq}</td>
       <td><button class="ghost sm close" data-code="\${esc(r.code)}">Close</button></td></tr>\`).join('') || '<tr><td colspan=6 class="muted">No rooms.</td></tr>'}
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
  document.querySelectorAll('.delchat').forEach(b => b.onclick = async () => {
    await j('/admin/chat/'+b.dataset.id+'/delete',{method:'POST'}); load();
  });
  document.getElementById('logout').onclick = async () => { await j('/admin/logout',{method:'POST'}); signedOut(); };
}
function signedOut(){ who.textContent=''; app.innerHTML = '<div class="signin"><p>Admin access requires Discord sign-in.</p><p><a href="/admin/login"><button>Sign in with Discord</button></a></p></div>'; }
load();
</script></body></html>`;
