# Alpha Quant Analytics

Quantitative tick-level analysis web app for the Beta Proprietary Trading Algorithm.

**Version:** v86 | **Last Updated:** April 1, 2026

## Features
- Stage 1: Cycle measurement, analysis, seasonality, trends, optimal TP%
- Stage 2: Hourly optimal TP% scanner (Cloudflare Worker + Web Worker)
- Stage 3: Correlation analysis, 20 ML features catalog, feature extraction pipeline
- 17 pages, 35 functions, 10 SB methods, 7 database tables
- Single-file React 18 app with JetBrains Mono dark terminal aesthetic

## Build
```bash
npm install
npm run build
```
Output: `dist/index.html`

## Infrastructure
- **Frontend:** Cloudflare Pages (auto-deploy via GitHub Actions)
- **Database:** Supabase (PostgreSQL)
- **Compute:** Cloudflare Workers (hourly TP% scanner)
- **Data:** Polygon.io (trade ticks)


<!-- deployed -->

Thu Apr  2 06:44:21 UTC 2026
Thu Apr  2 06:52:29 UTC 2026
Thu Apr  2 06:54:37 UTC 2026
