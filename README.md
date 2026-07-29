# Auction Monitor

Coletor historico de lotes de leilao com painel local e integracao opcional com Telegram.

O acompanhamento das próximas origens de imóveis está no
[backlog de integrações](docs/REAL_ESTATE_INTEGRATIONS_TODO.md).

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

## Docker local

No Windows, use o override local para manter os dados em volumes Docker, construir
a imagem a partir do codigo atual e desabilitar o atualizador de producao:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Esse comando inicia o coletor da Leilo, PostgreSQL, MinIO e o painel em `http://localhost:3000`.
Os dados ficam nos volumes `postgres-data` e `minio-data`. O console do MinIO fica em
`http://localhost:9001` (usuario `auctionadmin`, senha `auctionsecret` no ambiente local).

O painel inicia uma coleta automaticamente e permite disparar novas coletas pelo botao `Atualizar coleta`.
Por padrao, a coleta funciona em modo continuo: ao concluir uma varredura completa, aguarda
`CATALOG_COLLECTION_IDLE_MS` (60 segundos por padrao) e inicia o ciclo seguinte. Falhas
aplicam o intervalo maior de `CATALOG_COLLECTION_ERROR_BACKOFF_MS` (cinco minutos por
padrao). Nao ha sobreposicao entre ciclos.

Para restaurar o agendamento tradicional, configure `CATALOG_COLLECTION_MODE=cron` e
informe a expressao em `CATALOG_COLLECTION_CRON`.

## Deploy automatico no Portainer Community

O workflow `.github/workflows/publish-image.yml` executa a cada push na branch `main`.
Ele publica `ghcr.io/namewellz/auction-monitor:latest` e uma tag imutavel com o SHA do
commit. A imagem e multi-arquitetura (`linux/amd64` e `linux/arm64`), atendendo tanto o
ambiente local quanto a VM ARM da Oracle Cloud.

O servico Watchtower consulta o registry a cada cinco minutos e atualiza somente os
containers que possuem a label `com.centurylinklabs.watchtower.enable=true`. PostgreSQL,
MinIO e o proprio Watchtower nao recebem essa label e nao sao atualizados automaticamente.
Imagens antigas da aplicacao sao removidas depois de um update bem-sucedido.

Configuracao inicial:

1. Faca o primeiro push para a branch `main` e aguarde o workflow publicar a imagem.
2. Em **Packages**, abra `auction-monitor`, entre em **Package settings** e altere a
   visibilidade para publica.
3. Atualize manualmente uma vez a stack no Portainer usando este `docker-compose.yml`.
4. Confirme nos logs do servico `watchtower` que o container foi iniciado e encontrou o
   `dashboard` na lista de containers monitorados.

Depois desse bootstrap, alteracoes de codigo publicadas em `:latest` sao instaladas sem
intervencao no Portainer. Mudancas no proprio `docker-compose.yml` (portas, volumes,
variaveis ou novos servicos) ainda exigem atualizar manualmente a stack no Portainer.

O `GITHUB_TOKEN` usado para publicar a imagem e fornecido automaticamente pelo Actions;
nao e necessario cadastrar secrets de deploy. Para publicar manualmente, abra
**Actions > Publish Docker image > Run workflow**.

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

Para recuperar todos os lotes de um evento encerrado da Leilo pelo ID do evento:

```bash
docker compose exec dashboard node dist/tools/collectLeiloEvent.js <event-id> Pesados
```

As tabelas analiticas do PostgreSQL sao `auction_events`, `market_lots`, `lot_snapshots`,
`lot_media`, `collection_sources` e `collection_runs`. Imagens sao baixadas para o MinIO,
convertidas para WebP, deduplicadas por SHA-256 e servidas pelo painel atraves de
`/api/media/:id`. A politica e aplicada no armazenamento compartilhado, portanto vale para
todos os sites presentes e futuros. O perfil padrao limita a imagem a `1280x960`, sem ampliar,
e usa qualidade 70. Ele pode ser ajustado com `MEDIA_IMAGE_MAX_WIDTH`,
`MEDIA_IMAGE_MAX_HEIGHT` e `MEDIA_IMAGE_QUALITY`.

### Monitoramento de filas

O endpoint `GET /api/operations/problems` expoe os itens pendentes, com falha ou esgotados
das filas de revalidacao, imagens e documentos. A resposta inclui paginacao, totais por
status, fila e origem, alem dos erros mais frequentes agrupados.

Filtros aceitos:

- `queue`: `revalidation`, `images` ou `documents`; aceita repeticao ou valores separados por virgula.
- `status`: `pending`, `failed` ou `exhausted`; aceita repeticao ou valores separados por virgula.
- `site`: identificador da origem.
- `minAgeMinutes`: idade minima do item parado.
- `limit`: quantidade por pagina, de 1 a 500.
- `offset`: deslocamento da pagina.

Exemplo:

```text
/api/operations/problems?queue=revalidation&status=failed,exhausted&minAgeMinutes=30&limit=100
```

Para migrar imagens antigas ao perfil configurado:

```bash
docker compose run --rm dashboard node dist/tools/optimizeMedia.js 500
```

O comando pode ser retomado com seguranca: imagens que ja possuem o perfil atual sao ignoradas.

## Validar scraper sem Telegram

```bash
docker compose -f docker-compose.scrape.yml run --rm scrape npm run scrape -- <url>
```

## Descobrir leiloeiros de imoveis

Este comando percorre o filtro de imoveis de Sao Paulo no Leilao Imovel, salva as
URLs de anuncios, extrai os dados dos leiloeiros e gera resumos em JSON e CSV:

```bash
npm run discover:real-estate-auctioneers
```

Os arquivos ficam em `artifacts/real-estate-auctioneers-sp`. A coleta espera 2,5
segundos entre requisicoes e pode ser retomada, pois cada anuncio processado e
salvo imediatamente em `listings.jsonl`.

```bash
npm run discover:real-estate-auctioneers -- --delay-ms 5000 --max-pages 100 --max-listings 500
```

Tambem estao disponiveis `--url`, `--output` e `--resume false`. Caso o portal
apresente a protecao Cloudflare, a execucao para e preserva o progresso, sem
tentar contornar o bloqueio.

### Franco Leiloes

Coleta diretamente da API publica usada pelo filtro de lotes residenciais da
Franco Leiloes e gera `lots.json`, `lots.csv`, `lots.raw.json` e `summary.json`:

```bash
npm run collect:franco-real-estate
```

Por padrao, usa a categoria 55 (Residenciais), espera 750 ms entre blocos e
grava os arquivos em `artifacts/franco-real-estate`. Para cada lote, todas as
fotos e os documentos publicados (edital, matricula, condicoes e outros anexos)
sao baixados em `lots/<lotId>/photos` e `lots/<lotId>/documents`. O JSON registra
URL original, caminho local, tipo, tamanho e SHA-256 de cada arquivo. Os parametros
`--category`, `--delay-ms`, `--download-concurrency` e `--output` permitem alterar
os valores da coleta. As fotos usam o mesmo perfil dos veiculos: WebP, limite
padrao de 1280x960 e qualidade 70. O perfil pode ser alterado com
`MEDIA_IMAGE_MAX_WIDTH`, `MEDIA_IMAGE_MAX_HEIGHT`, `MEDIA_IMAGE_QUALITY` ou pelos
argumentos equivalentes `--image-max-width`, `--image-max-height` e
`--image-quality`. Documentos PDF permanecem inalterados.

O provider `francoleiloes` tambem participa da coleta principal do dashboard. Os
imoveis sao persistidos no mesmo catalogo, com tipo de bem `real_estate`, e os
filtros incluem estado, cidade e bairro. Fotos continuam sendo convertidas para
WebP; documentos sao preservados e armazenados no MinIO com tipo, rotulo, hash e
tamanho. Isso tambem habilita o download dos editais expostos pelos providers de
veiculos que ja informam `documentUrls`.

## Preparacao para arquivamento de midia

Cada objeto armazenado possui provedor e camada (`hot` ou `archive`), data do
ultimo acesso e bucket. A tabela `storage_migrations` registra uma futura copia
para um armazenamento externo com hash esperado e verificado, permitindo o fluxo
seguro **copiar -> verificar -> trocar referencia -> remover origem**. O endpoint
`GET /api/storage/stats` resume quantidade e bytes por tipo, provedor e camada.

Esta versao nao transfere nem remove objetos automaticamente: o destino externo,
credenciais e prazo de retencao ainda precisam ser definidos antes de ativar um
worker de arquivamento. Assim, a preparacao do banco pode entrar em producao sem
risco de movimentar os dados atuais do Oracle Cloud.

### Alessandro Teixeira Leiloes

O provider `alessandroteixeira` consulta a API publica do site, percorre todas as
paginas e importa somente a categoria de imoveis. Registros marcados como teste ou
simulacao sao ignorados. Fotos sao obtidas em 640x480, convertidas pelo perfil WebP
comum, e anexos como edital, matricula e laudo sao preservados no MinIO. O intervalo
entre paginas pode ser configurado com `ALESSANDRO_REQUEST_INTERVAL_MS`.

O provider `alvaroleiloes` reutiliza o mesmo adaptador para o Alvaro Leiloes e pode
ser regulado com `ALVARO_REQUEST_INTERVAL_MS`. Ele tambem filtra a categoria real de
imoveis, usa fotos em 640x480 e preserva todos os anexos publicados.
