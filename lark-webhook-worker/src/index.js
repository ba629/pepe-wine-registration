// Lark webhook — receives the wine-night-register.html form POST and
// writes one record into the "ลงทะเบียนงาน" table in Lark Base.
//
// Secrets (set with `wrangler secret put <name>`, never committed to git):
//   LARK_APP_ID       - Lark app id
//   LARK_APP_SECRET   - Lark app secret
// Plain vars (set in wrangler.toml, not secret):
//   LARK_BASE_TOKEN   - the Base's app_token (from its URL)
//   LARK_TABLE_ID     - the target table id (from its URL)
//   ALLOWED_ORIGIN    - the GitHub Pages origin allowed to call this worker

const LARK_HOST = 'https://open.larksuite.com'; // use open.feishu.cn for a China-region Feishu app

// Fixed event details — same for every guest, so this file never changes per request.
// Keep in sync with CONFIG in index.html if the date/time/venue ever changes.
const ICS_CONTENT = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SUITCUBE//An Evening with SUITCUBE//TH',
  'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  'BEGIN:VEVENT', 'UID:an-evening-with-suitcube@pepe-bangkok',
  'DTSTAMP:20260908T000000Z',
  'DTSTART:20261002T110000Z', // 2026-10-02 18:00 +07:00
  'DTEND:20261002T133000Z',   // 2026-10-02 20:30 +07:00
  'SUMMARY:An Evening with SUITCUBE — PEPÉ Bangkok',
  'LOCATION:PEPÉ Bangkok',
  'DESCRIPTION:ที่จอดรถฟรี 2 จุด: หน้าร้าน PEPÉ Bangkok และอพาร์ตเมนต์ P.W.T. Mansion',
  'URL:https://maps.app.goo.gl/4hZrMaCYBn8J3DdW6',
  'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:An Evening with SUITCUBE', 'END:VALARM',
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function getTenantToken(env) {
  const res = await fetch(`${LARK_HOST}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.LARK_APP_ID, app_secret: env.LARK_APP_SECRET }),
  });
  const data = await res.json();
  if (!data.tenant_access_token) throw new Error('lark auth failed: ' + JSON.stringify(data));
  return data.tenant_access_token;
}

// map the form's raw payload onto the Thai field names created in Lark Base
function toLarkFields(body) {
  const attendMap = { yes: 'เข้าร่วม', no: 'ไม่สะดวก' };
  return {
    'ชื่อ–นามสกุล': body.name || '',
    'เบอร์โทร': body.phone || '',
    'การเข้าร่วม': attendMap[body.attending] || body.attending || '',
    'จำนวนผู้เข้าร่วม': Number(body.guests) || 0,
    'ชื่อผู้ติดตาม': Array.isArray(body.companions) ? body.companions.join(', ') : '',
    'มีอาการแพ้อาหาร': body.hasAllergy ? 'มี' : 'ไม่มี',
    'รายการที่แพ้': Array.isArray(body.allergies) ? body.allergies : [],
    'รายละเอียดที่แพ้(เพิ่มเติม)': body.allergyNote || '',
    'รูปแบบอาหาร': body.diet || 'ทานได้ทุกอย่าง',
    'อาหารที่ไม่รับประทาน': Array.isArray(body.avoid) ? body.avoid : [],
    'หมายเหตุอาหารเพิ่มเติม': body.avoidNote || '',
    'รายการที่แพ้ (ผู้ติดตาม)': Array.isArray(body.allergiesCompanion) ? body.allergiesCompanion : [],
    'รายละเอียดที่แพ้ (ผู้ติดตาม)': body.allergyNoteCompanion || '',
    'รูปแบบอาหาร (ผู้ติดตาม)': body.dietCompanion || '',
    'อาหารที่ไม่รับประทาน (ผู้ติดตาม)': Array.isArray(body.avoidCompanion) ? body.avoidCompanion : [],
    'หมายเหตุอาหารเพิ่มเติม (ผู้ติดตาม)': body.avoidNoteCompanion || '',
    'ข้อความถึงผู้จัดงาน': body.note || '',
  };
}

async function createRecord(env, fields) {
  const token = await getTenantToken(env);
  const url = `${LARK_HOST}/open-apis/bitable/v1/apps/${env.LARK_BASE_TOKEN}/tables/${env.LARK_TABLE_ID}/records`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('lark create record failed: ' + JSON.stringify(data));
  return data;
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const url = new URL(request.url);

    // Plain https link to a real .ics file — works as a normal page navigation
    // in every browser (not a JS trick), so it isn't blocked by in-app webviews
    // or non-Safari iOS browsers the way a data: URI sometimes is.
    if (request.method === 'GET' && url.pathname === '/event.ics') {
      return new Response(ICS_CONTENT, {
        status: 200,
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'inline; filename="an-evening-with-suitcube.ics"',
        },
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors(origin) });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors(origin) });
    }

    try {
      const body = await request.json();
      const fields = toLarkFields(body);
      await createRecord(env, fields);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...cors(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...cors(origin) },
      });
    }
  },
};
