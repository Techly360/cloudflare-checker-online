const dns = require('node:dns/promises');
const net = require('node:net');

const CF_V4 = ['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22'];
const CF_V6 = ['2400:cb00::/32','2606:4700::/32','2803:f800::/32','2405:b500::/32','2405:8100::/32','2a06:98c0::/29','2c0f:f248::/32'];
const PRIVATE = ['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','::1/128','fc00::/7','fe80::/10'];

function toBig(ip) {
  if (net.isIPv4(ip)) return ip.split('.').reduce((a, o) => (a << 8n) | BigInt(o), 0n);
  let [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const parts = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return parts.reduce((a, p) => (a << 16n) | BigInt(parseInt(p || '0', 16)), 0n);
}
function inRange(ip, cidr) {
  const [base, bits] = cidr.split('/');
  if (net.isIP(ip) !== net.isIP(base)) return false;
  const size = net.isIPv4(ip) ? 32n : 128n;
  const shift = size - BigInt(bits);
  return (toBig(ip) >> shift) === (toBig(base) >> shift);
}
const inAny = (ip, list) => list.some((c) => inRange(ip, c));

function cleanDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].split('@').pop().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z0-9-]{2,63}$/.test(s) && !/^xn--/.test(s)) return null;
  return s;
}

const safe = (p) => p.catch(() => []);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  const domain = cleanDomain(req.query.domain);
  if (!domain) return res.status(400).json({ error: 'Enter a valid domain, such as example.com.' });

  // DNS signals (nameservers are looked up on the domain, then its parent domains)
  const labels = domain.split('.');
  let nameservers = [];
  for (let i = 0; i < labels.length - 1 && !nameservers.length; i++) {
    nameservers = await safe(dns.resolveNs(labels.slice(i).join('.')));
  }
  const [v4, v6] = await Promise.all([safe(dns.resolve4(domain)), safe(dns.resolve6(domain))]);
  const ips = [...v4, ...v6];
  if (!ips.length && !nameservers.length) {
    return res.status(404).json({ error: 'This domain has no DNS records. Check the spelling.' });
  }

  const cfNs = nameservers.filter((n) => n.toLowerCase().endsWith('.ns.cloudflare.com'));
  const cfIps = ips.filter((ip) => inAny(ip, net.isIPv4(ip) ? CF_V4 : CF_V6));

  // HTTP signal (skipped when the domain points at a private address)
  let http = { checked: false, status: null, server: null, cfRay: null, cacheStatus: null, error: null };
  if (ips.length && !ips.some((ip) => inAny(ip, PRIVATE))) {
    try {
      const r = await fetch(`https://${domain}`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(6000),
        headers: { 'user-agent': 'CloudflareChecker/1.0' },
      });
      http = { checked: true, status: r.status, server: r.headers.get('server'), cfRay: r.headers.get('cf-ray'), cacheStatus: r.headers.get('cf-cache-status'), error: null };
      r.body?.cancel?.();
    } catch (e) {
      http.error = 'The site did not respond over HTTPS.';
    }
  }
  const cfHeaders = !!(http.cfRay || (http.server || '').toLowerCase().includes('cloudflare'));

  const signals = { nameservers: cfNs.length > 0, ip: cfIps.length > 0, headers: cfHeaders };
  const proxied = signals.ip || signals.headers;
  const verdict = proxied ? 'proxied' : signals.nameservers ? 'dns-only' : 'none';

  res.status(200).json({ domain, verdict, signals, details: { nameservers, cloudflareNameservers: cfNs, ips, cloudflareIps: cfIps, http } });
};
