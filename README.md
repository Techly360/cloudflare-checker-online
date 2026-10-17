# Cloudflare Checker

Enter a domain and see whether it uses Cloudflare. Three independent signals are checked:

1. **Nameservers**: DNS is hosted on Cloudflare (`*.ns.cloudflare.com`).
2. **IP address**: the domain resolves to a Cloudflare IP range (traffic is proxied).
3. **HTTP headers**: the response carries `server: cloudflare` or a `cf-ray` header.

## Deploy
1. Push this folder to a GitHub repo.
2. In Vercel, choose **Add New → Project**, import the repo, and click **Deploy**. No build settings are needed.

## Local test
`npx vercel dev`

## Notes
- `sitemap.xml` and `robots.txt` are generated automatically from your Vercel link, so no domain setup is needed.
- Cloudflare IP ranges are hardcoded in `api/check.js`. Compare against https://www.cloudflare.com/ips/ now and then.
- Private and internal addresses are blocked to prevent server-side request forgery.
- Sites that use Cloudflare only as DNS (grey cloud) show nameservers = yes, proxy = no.
