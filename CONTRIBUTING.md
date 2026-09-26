# Contributing to Hallucination Hunter

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/Sunil56224972/hallucination-Hunter.git
cd hallucination-Hunter
echo "window.GROQ_API_KEY = 'your-key';" > config.js
npx live-server --port=3000
```

## Guidelines

- **Code style:** Vanilla JS, no frameworks. Keep it lightweight.
- **Commits:** Use conventional commits (`feat:`, `fix:`, `docs:`).
- **Testing:** Test on Chrome + Edge before submitting.
- **Security:** Never commit API keys or secrets.

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Reporting Issues

Use GitHub Issues with a clear title and description. Include:
- Browser and version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable

## Code of Conduct

Be respectful, inclusive, and constructive. We're building trust in AI together.
