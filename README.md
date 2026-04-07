# domain-checker

CLI tool to check domain availability across 30+ TLDs at once. Gets WHOIS, DNS, SSL, and hosting info for each domain and generates a detailed Markdown report.

## Features

- Checks 30+ TLDs in parallel (.com, .net, .io, .ai, .dev, .com.br, etc.)
- WHOIS lookup (registrar, expiry, creation date, status, DNSSEC)
- DNS records (A, AAAA, CNAME, NS, MX, TXT)
- SSL certificate info (issuer, expiry, SANs)
- HTTP status and server detection
- IP geolocation and hosting provider
- Generates a Markdown report with all results
- Color-coded terminal output with expiry warnings

## Usage

### With npx (no install needed)

```bash
npx domain-checker myproject
```

### Global install

```bash
npm install -g domain-checker
domain-checker myproject
```

### From source

```bash
git clone https://github.com/henrique-leme/domain-checker.git
cd domain-checker
npm install
node index.js myproject
```

## Examples

```bash
# Check all TLDs for "deckforge"
domain-checker deckforge

# Pass a URL — it extracts the name automatically
domain-checker https://www.example.com
```

The tool will:
1. Scan all TLDs in parallel
2. Show a color-coded summary (available / registered)
3. Print detailed info for registered domains
4. Save a Markdown report to `./output/`

## Output

The generated report includes:
- Summary table with status, expiry, registrar, and hosting
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
