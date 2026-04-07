# domain-scan

CLI tool to check domain availability across 40+ TLDs at once — querying WHOIS and DNS directly, without going through provider search pages.

## Why?

Domain providers like GoDaddy and Hostinger are known for **domain front-running**: when you search for a domain on their site, they may reserve it before you buy, forcing you to pay a higher price. This tool queries WHOIS/DNS servers directly, so no provider knows what you're looking for.

## Features

- Checks 40+ TLDs in parallel (.com, .net, .io, .ai, .dev, .com.br, .co.uk, etc.)
- Direct WHOIS/DNS queries — no provider middleman
- WHOIS lookup (provider, expiry, creation date, owner, status)
- DNS records (A, AAAA, CNAME, NS, MX, TXT)
- SSL certificate info (issuer, expiry, SANs)
- HTTP status and server detection
- IP geolocation and hosting provider
- Markdown report generation
- Color-coded terminal output with expiry warnings

## Usage

### With npx (no install needed)

```bash
npx domain-scan myproject
```

### Global install

```bash
npm install -g domain-scan
domain-scan myproject
```

### From source

```bash
git clone https://github.com/henrique-leme/domain-scan.git
cd domain-checker
npm install
node index.js myproject
```

## Examples

```bash
# Quick scan — availability, expiry, and owner
domain-scan myproject

# Deep scan — full WHOIS, DNS, SSL, HTTP, and hosting details
domain-scan myproject --deep

# Save a detailed Markdown report
domain-scan myproject --md

# Check only specific TLDs
domain-scan myproject --only=com
domain-scan myproject --only=com,com.br,io

# Combine flags
domain-scan myproject --deep --md

# Pass a URL — it extracts the name automatically
domain-scan https://www.google.com
```

## Options

| Flag | Description |
|------|-------------|
| `--only=<ext>` | Check specific TLDs (comma-separated, e.g. `--only=com,io,com.br`) |
| `--deep` | Show full details (WHOIS, DNS, SSL, HTTP, hosting) |
| `--md` | Save a detailed Markdown report to `./output_domain_checker/` |
| `--help` | Show help message |

The tool will:
1. Scan all TLDs in parallel
2. Show a color-coded summary (availability, expiry date, owner)
3. With `--deep`: print full details for registered domains
4. With `--md`: save a Markdown report to `./output_domain_checker/`

## Report Output

When using `--md`, the generated report includes:
- Summary table with status, expiry, provider, and hosting
- List of available domains
- Detailed breakdown per registered domain (WHOIS, DNS, SSL, HTTP, hosting)

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE) - Henrique Leme
