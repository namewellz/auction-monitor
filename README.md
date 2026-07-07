# Auction Monitor

Coletor historico de lotes de leilao com painel local e integracao opcional com Telegram.

## Uso local

```bash
npm install
cp .env.example .env
npm run dev
```

Preencha `TELEGRAM_BOT_TOKEN` no `.env`. Para restringir o uso, informe IDs em `TELEGRAM_ALLOWED_CHAT_IDS` separados por virgula.

## Comandos do bot

```text
/add <url>
/list
/details <id>
/remove <id>
/pause <id>
/resume <id>
/max <id> <valor>
```

Enviar apenas uma URL tambem aciona o fluxo de `/add`.

## Docker

```bash
docker compose up --build
```

Esse comando inicia o coletor da Leilo, PostgreSQL, MinIO e o painel em `http://localhost:3000`.
Os dados ficam nos volumes `postgres-data` e `minio-data`. O console do MinIO fica em
`http://localhost:9001` (usuario `auctionadmin`, senha `auctionsecret` no ambiente local).

O painel inicia uma coleta automaticamente e permite disparar novas coletas pelo botao `Atualizar coleta`.

Para iniciar tambem o bot Telegram:

```bash
docker compose --profile telegram up --build
```

## Coleta historica

Configure `COLLECTOR_SOURCES` com paginas de eventos, categorias ou listagens separadas por virgula. O collector descobre links de lotes, armazena snapshots e agenda revalidacoes antes e depois do encerramento.

Para persistir uma URL diretamente, sem Telegram:

```bash
docker compose -f docker-compose.scrape.yml run --rm scrape npm run collect:url -- <url>
```

As tabelas analiticas do PostgreSQL sao `auction_events`, `market_lots`, `lot_snapshots`,
`lot_media`, `collection_sources` e `collection_runs`. Imagens sao baixadas para o MinIO,
convertidas para WebP, deduplicadas por SHA-256 e servidas pelo painel atraves de
`/api/media/:id`. A politica e aplicada no armazenamento compartilhado, portanto vale para
todos os sites presentes e futuros. O perfil padrao limita a imagem a `1280x960`, sem ampliar,
e usa qualidade 70. Ele pode ser ajustado com `MEDIA_IMAGE_MAX_WIDTH`,
`MEDIA_IMAGE_MAX_HEIGHT` e `MEDIA_IMAGE_QUALITY`.

Para migrar imagens antigas ao perfil configurado:

```bash
docker compose run --rm dashboard node dist/tools/optimizeMedia.js 500
```

O comando pode ser retomado com seguranca: imagens que ja possuem o perfil atual sao ignoradas.

## Validar scraper sem Telegram

```bash
docker compose -f docker-compose.scrape.yml run --rm scrape npm run scrape -- <url>
```
