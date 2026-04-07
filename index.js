#!/usr/bin/env node

const whoiser = require('whoiser');
const dns     = require('dns').promises;
const tls     = require('tls');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const chalk   = require('chalk');
const ora     = require('ora');
const boxen   = require('boxen');

const input = process.argv[2];

if (!input) {
  console.log(chalk.red('Usage: node index.js <name>'));
  console.log(chalk.gray('Example: node index.js deckforge'));
  process.exit(1);
}

// Strip URL / www / path / any TLD — keep only the SLD name
const name = input
  .replace(/^https?:\/\//, '')
  .replace(/^www\./, '')
  .replace(/\/.*$/, '')
  .toLowerCase()
  .trim()
  .split('.')[0];

const TLDS = [
  // Global essentials
  'com', 'net', 'org', 'io', 'ai', 'app', 'dev', 'co', 'me', 'us', 'info', 'biz', 'xyz',
  // Tech / niche
  'gg', 'tech', 'digital', 'online', 'site', 'store', 'cloud', 'pro', 'games', 'software',
  // Brazil
  'com.br', 'net.br', 'org.br',
  // International
  'co.uk', 'de', 'fr', 'es', 'pt', 'eu', 'ca', 'com.au',
];

const domains = TLDS.map(tld => `${name}.${tld}`);

// ─── Date helpers ────────────────────────────────────────────────────────────

function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}`);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function formatDate(s) {
  if (!s) return null;
  s = String(s).trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toISOString().split('T')[0];
}

function daysUntil(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  return Math.ceil((d - Date.now()) / 86400000);
}

function expiryTextPlain(days, dateStr) {
  const date = formatDate(dateStr) || '';
  if (days === null) return 'N/A';
  if (days < 0)  return `EXPIRED (${date})`;
  if (days < 30) return `⚠️ ${days}d — CRITICAL (${date})`;
  if (days < 90) return `${days}d — soon (${date})`;
  return `${days}d (${date})`;
}

function expiryColor(days) {
  if (days === null)  return chalk.gray('N/A');
  if (days < 0)       return chalk.red.bold('EXPIRED');
  if (days < 30)      return chalk.red.bold(`${days} days (CRITICAL)`);
  if (days < 90)      return chalk.yellow.bold(`${days} days (soon)`);
  return chalk.green(`${days} days`);
}

// ─── Data fetchers ───────────────────────────────────────────────────────────

async function getWhois(domain) {
  try {
    const result = await whoiser.whoisDomain(domain, { follow: 2, timeout: 8000 });
    const data = Object.values(result).find(r =>
      r['Domain Name'] || r['domain name'] || r['Expiry Date'] ||
      r['Registry Expiry Date'] || r['Expiration Date'] || r['Created']
    ) || {};

    const get = (...keys) => {
      for (const k of keys) {
        const v = data[k] || data[k.toLowerCase()];
        if (v) return Array.isArray(v) ? v[0] : String(v);
      }
      return null;
    };

    const nameservers = data['Name Server'] || data['name server'] || data['Nameservers'] || [];
    const ns = Array.isArray(nameservers)
      ? nameservers.map(s => s.toLowerCase()).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6)
      : nameservers ? [String(nameservers).toLowerCase()] : [];

    const rawStatus  = get('Domain Status', 'domain status', 'Status', 'status');
    const cleanStatus = rawStatus ? rawStatus.replace(/https?:\/\/\S+/g, '').trim() : null;
    const pickDate   = v => v ? String(v).trim().split(/\s+/)[0] : null;

    return {
      domainName:   get('Domain Name', 'domain name', 'domain'),
      registrar:    get('Registrar', 'registrar', 'Registrar Name', 'owner'),
      registrarUrl: get('Registrar URL', 'registrar url', 'Registrar Url'),
      createdAt:    pickDate(get('Creation Date', 'creation date', 'Created Date', 'Domain Registration Date', 'Created', 'created')),
      updatedAt:    pickDate(get('Updated Date', 'updated date', 'Last Modified', 'Domain Last Updated Date', 'changed')),
      expiresAt:    pickDate(get('Registry Expiry Date', 'Registrar Registration Expiration Date', 'Expiry Date', 'Expiration Date', 'expiry date', 'expire date', 'expires', 'Expires')),
      status:       cleanStatus,
      dnssec:       get('DNSSEC', 'dnssec'),
      owner:        get('Registrant Name', 'registrant name', 'Registrant Organization', 'registrant organization', 'Admin Name', 'owner-c', 'nic-hdl'),
      ownerEmail:   get('Registrant Email', 'registrant email', 'Admin Email', 'e-mail'),
      ownerCountry: get('Registrant Country', 'registrant country', 'country'),
      nameservers:  ns,
    };
  } catch {
    return {};
  }
}

async function getDns(domain) {
  const safe = async fn => { try { return await fn(); } catch { return null; } };
  const [a, aaaa, mx, txt, ns, cname] = await Promise.all([
    safe(() => dns.resolve4(domain)),
    safe(() => dns.resolve6(domain)),
    safe(() => dns.resolveMx(domain)),
    safe(() => dns.resolveTxt(domain)),
    safe(() => dns.resolveNs(domain)),
    safe(() => dns.resolveCname(domain)),
  ]);
  return {
    a:     a || [],
    aaaa:  aaaa || [],
    mx:    mx ? mx.sort((a, b) => a.priority - b.priority).map(r => `${r.exchange} (priority ${r.priority})`) : [],
    txt:   txt ? txt.map(r => r.join('')).slice(0, 5) : [],
    ns:    ns || [],
    cname: cname || [],
  };
}

function getSsl(host) {
  return new Promise(resolve => {
    const socket = tls.connect(443, host, { servername: host, timeout: 5000, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      socket.destroy();
      if (!cert || !cert.subject) return resolve(null);
      resolve({
        subject:   cert.subject?.CN || null,
        issuer:    cert.issuer?.O || cert.issuer?.CN || null,
        validFrom: cert.valid_from || null,
        validTo:   cert.valid_to || null,
        san:       cert.subjectaltname ? cert.subjectaltname.replace(/DNS:/g, '').split(', ').slice(0, 4) : [],
      });
    });
    socket.on('error', () => resolve(null));
    socket.setTimeout(5000, () => { socket.destroy(); resolve(null); });
  });
}

function getHttpStatus(host) {
  return new Promise(resolve => {
    const req = https.request({ hostname: host, path: '/', method: 'HEAD', timeout: 5000, rejectUnauthorized: false }, res => {
      resolve({ status: res.statusCode, server: res.headers['server'] || null, redirect: res.headers['location'] || null });
    });
    req.on('error', () => {
      const req2 = http.request({ hostname: host, path: '/', method: 'HEAD', timeout: 5000 }, res => {
        resolve({ status: res.statusCode, server: res.headers['server'] || null, redirect: res.headers['location'] || null, http: true });
      });
      req2.on('error', () => resolve(null));
      req2.setTimeout(5000, () => { req2.destroy(); resolve(null); });
      req2.end();
    });
    req.setTimeout(5000, () => { req.destroy(); });
    req.end();
  });
}

function getIpInfo(ip) {
  return new Promise(resolve => {
    const req = http.request({ hostname: 'ip-api.com', path: `/json/${ip}?fields=country,regionName,city,isp,org,as`, method: 'GET', timeout: 5000 }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ─── Check single domain ─────────────────────────────────────────────────────

async function checkDomain(domain) {
  const [whois, dnsData] = await Promise.all([getWhois(domain), getDns(domain)]);

  // Some WHOIS servers return "AVAILABLE" or "No match" for free domains
  const statusAvailable = whois.status && /^(available|no match|not found|free)$/i.test(whois.status.trim());
  const hasWhois = !statusAvailable && !!(whois.domainName || whois.registrar || whois.createdAt || whois.expiresAt);
  const hasDns   = dnsData.a.length > 0 || dnsData.aaaa.length > 0 || dnsData.ns.length > 0;

  if (!hasWhois && !hasDns) {
    return { domain, registered: false, whois: {}, dns: dnsData, ssl: null, httpInfo: null, ipInfo: null, primaryIp: null };
  }

  const primaryIp = dnsData.a[0] || null;
  const [ssl, httpInfo, ipInfo] = await Promise.all([
    getSsl(domain),
    getHttpStatus(domain),
    primaryIp ? getIpInfo(primaryIp) : Promise.resolve(null),
  ]);

  return { domain, registered: true, whois, dns: dnsData, ssl, httpInfo, ipInfo, primaryIp };
}

// ─── Console print ───────────────────────────────────────────────────────────

function lbl(text)  { return chalk.cyan.bold(text.padEnd(22)); }
function v(text)    { return chalk.white(text ?? chalk.gray('N/A')); }
function sec(title) { console.log('\n' + chalk.yellow.bold(`  ── ${title} ──`)); }

function row(key, value) {
  console.log(`  ${lbl(key + ':')}${value ? v(value) : chalk.gray('N/A')}`);
}

function rowsList(key, values) {
  if (!values || !values.length) { row(key, null); return; }
  values.forEach((val, i) => {
    if (i === 0) console.log(`  ${lbl(key + ':')}${v(val)}`);
    else console.log(`  ${' '.repeat(23)}${v(val)}`);
  });
}

function printResult(r) {
  const { domain, whois: w, dns: d, ssl, httpInfo, ipInfo, primaryIp } = r;

  sec(`${domain} — WHOIS`);
  row('Domain',        w.domainName || domain);
  row('Registrar',     w.registrar);
  row('Registrar URL', w.registrarUrl);
  const expDays = daysUntil(w.expiresAt);
  console.log(`  ${lbl('Expires:')}${expiryColor(expDays)}${w.expiresAt ? chalk.gray(` (${formatDate(w.expiresAt)})`) : ''}`);
  row('Created',       formatDate(w.createdAt));
  row('Updated',       formatDate(w.updatedAt));
  row('Status',        w.status);
  row('DNSSEC',        w.dnssec);

  sec(`${domain} — Registrant`);
  row('Name',    w.owner);
  row('Email',   w.ownerEmail);
  row('Country', w.ownerCountry);

  sec(`${domain} — DNS`);
  rowsList('A (IPv4)',    d.a);
  rowsList('AAAA (IPv6)', d.aaaa);
  rowsList('CNAME',       d.cname);
  rowsList('NS',          d.ns.length ? d.ns : (w.nameservers || []));
  rowsList('MX',          d.mx);
  if (d.txt.length) rowsList('TXT', d.txt);

  if (ipInfo || primaryIp) {
    sec(`${domain} — Hosting`);
    row('IP Address',   primaryIp);
    if (ipInfo) {
      row('ISP',          ipInfo.isp);
      row('Organization', ipInfo.org);
      row('ASN',          ipInfo.as);
      row('City',         ipInfo.city);
      row('Region',       ipInfo.regionName);
      row('Country',      ipInfo.country);
    }
  }

  if (ssl) {
    const sslDays = daysUntil(ssl.validTo);
    sec(`${domain} — SSL`);
    row('Subject',    ssl.subject);
    row('Issuer',     ssl.issuer);
    row('Valid From', formatDate(ssl.validFrom));
    console.log(`  ${lbl('Valid Until:')}${expiryColor(sslDays)}${ssl.validTo ? chalk.gray(` (${formatDate(ssl.validTo)})`) : ''}`);
    if (ssl.san.length) rowsList('SANs', ssl.san);
  }

  if (httpInfo) {
    sec(`${domain} — HTTP`);
    const proto     = httpInfo.http ? 'HTTP' : 'HTTPS';
    const code      = httpInfo.status;
    const codeColor = code < 300 ? chalk.green : code < 400 ? chalk.yellow : chalk.red;
    console.log(`  ${lbl('Protocol:')}${chalk.cyan(proto)}`);
    console.log(`  ${lbl('Status Code:')}${codeColor(code)}`);
    if (httpInfo.server)   row('Server',       httpInfo.server);
    if (httpInfo.redirect) row('Redirects to', httpInfo.redirect);
  }
}

// ─── Markdown builder ────────────────────────────────────────────────────────

function buildMarkdown(results) {
  const date = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const lines = [];

  lines.push(`# Domain Scan: \`${name}\``);
  lines.push(`**Generated:** ${date}  `);
  lines.push(`**Domains checked:** ${results.length}  `);
  lines.push(`**Registered:** ${results.filter(r => r.registered).length}  `);
  lines.push(`**Available:** ${results.filter(r => !r.registered).length}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Domain | Status | Expires | Registrar | IP | Hosting |');
  lines.push('|--------|:------:|---------|-----------|-----|---------|');

  for (const r of results) {
    if (r.registered) {
      const expDays = daysUntil(r.whois.expiresAt);
      const expStr  = expiryTextPlain(expDays, r.whois.expiresAt);
      const host    = r.ipInfo?.org || r.ipInfo?.isp || r.primaryIp || 'N/A';
      lines.push(`| **\`${r.domain}\`** | 🔴 Registered | ${expStr} | ${r.whois.registrar || 'N/A'} | ${r.primaryIp || 'N/A'} | ${host} |`);
    } else {
      lines.push(`| \`${r.domain}\` | 🟢 **Available** | — | — | — | — |`);
    }
  }

  lines.push('');

  // Available
  const available = results.filter(r => !r.registered);
  if (available.length) {
    lines.push('## 🟢 Available Domains');
    lines.push('');
    for (const r of available) lines.push(`- \`${r.domain}\``);
    lines.push('');
  }

  // Registered details
  const registered = results.filter(r => r.registered);
  if (registered.length) {
    lines.push('## 🔴 Registered Domains — Details');
    lines.push('');

    for (const r of registered) {
      lines.push(`### \`${r.domain}\``);
      lines.push('');

      // WHOIS
      lines.push('#### WHOIS / Registration');
      lines.push('');
      lines.push('| Field | Value |');
      lines.push('|-------|-------|');
      lines.push(`| Domain | ${r.whois.domainName || r.domain} |`);
      lines.push(`| Registrar | ${r.whois.registrar || 'N/A'} |`);
      lines.push(`| Registrar URL | ${r.whois.registrarUrl || 'N/A'} |`);
      const expDays = daysUntil(r.whois.expiresAt);
      lines.push(`| Expires | ${expiryTextPlain(expDays, r.whois.expiresAt)} |`);
      lines.push(`| Created | ${formatDate(r.whois.createdAt) || 'N/A'} |`);
      lines.push(`| Updated | ${formatDate(r.whois.updatedAt) || 'N/A'} |`);
      lines.push(`| Status | ${r.whois.status || 'N/A'} |`);
      lines.push(`| DNSSEC | ${r.whois.dnssec || 'N/A'} |`);
      lines.push('');

      // Owner
      lines.push('#### Registrant / Owner');
      lines.push('');
      lines.push('| Field | Value |');
      lines.push('|-------|-------|');
      lines.push(`| Name | ${r.whois.owner || 'N/A'} |`);
      lines.push(`| Email | ${r.whois.ownerEmail || 'N/A'} |`);
      lines.push(`| Country | ${r.whois.ownerCountry || 'N/A'} |`);
      lines.push('');

      // DNS
      const ns = r.dns.ns.length ? r.dns.ns : (r.whois.nameservers || []);
      if (r.dns.a.length || r.dns.aaaa.length || ns.length || r.dns.mx.length || r.dns.txt.length) {
        lines.push('#### DNS Records');
        lines.push('');
        lines.push('| Type | Value |');
        lines.push('|------|-------|');
        if (r.dns.a.length)    lines.push(`| A (IPv4) | ${r.dns.a.join(', ')} |`);
        if (r.dns.aaaa.length) lines.push(`| AAAA (IPv6) | ${r.dns.aaaa.join(', ')} |`);
        if (r.dns.cname.length) lines.push(`| CNAME | ${r.dns.cname.join(', ')} |`);
        if (ns.length)         lines.push(`| NS | ${ns.join(', ')} |`);
        if (r.dns.mx.length)   lines.push(`| MX | ${r.dns.mx.join('<br>')} |`);
        if (r.dns.txt.length)  lines.push(`| TXT | ${r.dns.txt.map(t => `\`${t}\``).join('<br>')} |`);
        lines.push('');
      }

      // Hosting
      if (r.ipInfo || r.primaryIp) {
        lines.push('#### Hosting / IP Info');
        lines.push('');
        lines.push('| Field | Value |');
        lines.push('|-------|-------|');
        lines.push(`| IP Address | ${r.primaryIp || 'N/A'} |`);
        if (r.ipInfo) {
          lines.push(`| ISP | ${r.ipInfo.isp || 'N/A'} |`);
          lines.push(`| Organization | ${r.ipInfo.org || 'N/A'} |`);
          lines.push(`| ASN | ${r.ipInfo.as || 'N/A'} |`);
          lines.push(`| Location | ${[r.ipInfo.city, r.ipInfo.regionName, r.ipInfo.country].filter(Boolean).join(', ')} |`);
        }
        lines.push('');
      }

      // SSL
      if (r.ssl) {
        const sslDays = daysUntil(r.ssl.validTo);
        lines.push('#### SSL Certificate');
        lines.push('');
        lines.push('| Field | Value |');
        lines.push('|-------|-------|');
        lines.push(`| Subject | ${r.ssl.subject || 'N/A'} |`);
        lines.push(`| Issuer | ${r.ssl.issuer || 'N/A'} |`);
        lines.push(`| Valid From | ${formatDate(r.ssl.validFrom) || 'N/A'} |`);
        lines.push(`| Valid Until | ${expiryTextPlain(sslDays, r.ssl.validTo)} |`);
        if (r.ssl.san.length) lines.push(`| SANs | ${r.ssl.san.join(', ')} |`);
        lines.push('');
      }

      // HTTP
      if (r.httpInfo) {
        lines.push('#### HTTP');
        lines.push('');
        lines.push('| Field | Value |');
        lines.push('|-------|-------|');
        lines.push(`| Protocol | ${r.httpInfo.http ? 'HTTP' : 'HTTPS'} |`);
        lines.push(`| Status Code | ${r.httpInfo.status} |`);
        if (r.httpInfo.server)   lines.push(`| Server | ${r.httpInfo.server} |`);
        if (r.httpInfo.redirect) lines.push(`| Redirects to | ${r.httpInfo.redirect} |`);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + boxen(
    chalk.bold.white('  Domain Checker') + '\n' +
    chalk.gray(`  Scanning: ${chalk.cyan(name + '.*')}  — ${domains.length} TLDs`),
    { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderStyle: 'round', borderColor: 'cyan' }
  ));

  const spinner = ora({ text: `Checking ${domains.length} domains in parallel...`, color: 'cyan' }).start();

  let done = 0;
  const results = await Promise.all(
    domains.map(d =>
      checkDomain(d).then(r => {
        done++;
        spinner.text = `[${done}/${domains.length}] ${d} → ${r.registered ? chalk.red('registered') : chalk.green('available')}`;
        return r;
      })
    )
  );

  spinner.stop();

  // ── Summary ───────────────────────────────────────────────────────────────
  const registered = results.filter(r => r.registered);
  const available  = results.filter(r => !r.registered);

  console.log('\n' + chalk.bold.white('  ── Scan Summary ──') + '\n');

  for (const r of results) {
    if (r.registered) {
      const expDays = daysUntil(r.whois.expiresAt);
      console.log(
        `  ${chalk.red('●')} ${chalk.white.bold(r.domain.padEnd(26))}` +
        `${chalk.gray('registered')}   expires: ${expiryColor(expDays)}` +
        (r.whois.expiresAt ? chalk.gray(` (${formatDate(r.whois.expiresAt)})`) : '')
      );
    } else {
      console.log(`  ${chalk.green('●')} ${chalk.green.bold(r.domain.padEnd(26))}${chalk.green('AVAILABLE')}`);
    }
  }

  console.log(`\n  ${chalk.red('●')} ${registered.length} registered   ${chalk.green('●')} ${available.length} available\n`);

  // ── Registered details ────────────────────────────────────────────────────
  if (registered.length) {
    console.log(chalk.bold.white('  ── Registered Domain Details ──'));
    for (const r of registered) printResult(r);
  }

  // ── Write output/<name>_YYYY-MM-DD_HH-MM-SS.md ───────────────────────────
  const md      = buildMarkdown(results);
  const ts      = new Date().toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 19);
  const outDir  = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outPath = path.join(outDir, `${name}_${ts}.md`);
  fs.writeFileSync(outPath, md, 'utf8');

  console.log('\n' + chalk.cyan(`  Report saved → ${outPath}`) + '\n');
}

main().catch(err => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
