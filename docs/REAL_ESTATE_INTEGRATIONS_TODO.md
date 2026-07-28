# Backlog de integrações de leilões de imóveis

Última revisão: 24/07/2026

Este arquivo é a fonte de acompanhamento dos sites de imóveis que devem entrar no Auction Data.
A lista recebida continha 85 ocorrências, sendo 43 domínios únicos após remover duplicidades e
parâmetros de rastreamento (`utm_*`).

## Resumo

- Total da lista: **43 sites**
- Integrados no código: **34**
- Pendentes: **9**
- Integração existente fora da lista: **1** (Franco Leilões)

## Critério para considerar uma integração concluída

Um item só deve ser marcado como concluído quando:

- [ ] A varredura do catálogo percorre todos os anúncios de imóveis.
- [ ] O detalhe do anúncio e a revalidação funcionam.
- [ ] Valores das praças, datas, status e localização são armazenados.
- [ ] Fotos são baixadas e otimizadas.
- [ ] Editais, matrículas e demais documentos são armazenados quando disponíveis.
- [ ] A origem aparece no mapa de integrações e pode ser atualizada individualmente.
- [ ] Uma coleta completa foi validada localmente e em produção.
- [ ] Não restam falhas permanentes no endpoint operacional.

## Integrados

As dez primeiras contagens são uma fotografia de produção em 24/07/2026. As três integrações
mais recentes estão validadas localmente e aguardam publicação.

- [x] **Alessandro Teixeira Leilões** — `alessandroteixeiraleiloes.com.br` — 14 lotes
- [x] **Álvaro Leilões** — `alvaroleiloes.com.br` — 123 lotes
- [x] **Bruno Leilões** — `brunoleiloes.com.br` — 7 lotes
- [x] **Calil Leilões** — `calilleiloes.com.br` — 343 lotes
- [x] **Capital Valor Leilões** — `capitalvalorleiloes.com.br` — 24 lotes
- [x] **Carlo Ferrari Leilões** — `carloferrarileiloes.com.br` — 17 lotes
- [x] **Cida Fixer Leilões** — `cidafixerleiloes.com.br` — 13 lotes
- [x] **D1 Lance** — `d1lance.com.br` — 127 lotes
- [x] **Da Silva Leilões** — `dasilvaleiloes.com.br` — 4 lotes
- [x] **Dó Leilões** — `doleiloes.com.br` — 11 lotes
- [x] **Akimoto Leilões** — `akimotoleiloes.com.br` — 2 lotes validados localmente
- [x] **Alessandra Leilões** — `alessandraleiloes.com.br` — 2 lotes válidos localmente
- [x] **Deonizia Leilões** — `deonizialeiloes.com.br` — 67 lotes válidos localmente
- [x] **JR Leilões** — `jrleiloes.com.br` — 186 lotes válidos localmente
- [x] **Giordano Leilões** — `giordanoleiloes.com.br` — 125 lotes válidos localmente
- [x] **Francisco Freitas Leilões** — `franciscofreitasleiloes.com.br` — identidade atual de Norte Nordeste Leilões; 102 lotes válidos localmente
- [x] **Rio Leilões** — `rioleiloes.com.br` — 76 lotes válidos localmente
- [x] **HD Leilões** — `hdleiloes.com.br` — 52 lotes válidos localmente
- [x] **TRI Leilões** — `trileiloes.com.br` — plataforma Suporte Leilões; integração de eventos e lotes
- [x] **Thaís Teixeira Leilões** — `thaisteixeiraleiloes.com.br` — 54 lotes identificados
- [x] **Valero Leilões** — `valeroleiloes.com.br` — plataforma Suporte Leilões; 48 referências identificadas
- [x] **Rigolon Leilões** — `rigolonleiloes.com.br` — 47 lotes identificados
- [x] **Leilões Judiciais Bahia** — `leiloesjudiciaisbahia.com.br` — 37 lotes identificados
- [x] **Fábio Leilões** — `fabioleiloes.com.br` — 27 lotes identificados
- [x] **Galvani Leilões** — `galvanileiloes.com.br` — 27 lotes identificados
- [x] **José Rodovalho Leilões** — `joserodovalholeiloes.com.br` — 27 lotes identificados
- [x] **Rosi Oliveira Leilões** — `rosioliveiraleiloes.com.br` — sucessora do domínio DM; 15 lotes identificados
- [x] **Fidelis Leilões** — `fidelisleiloes.com.br` — 14 lotes identificados
- [x] **Milan Leilões** — `milanleiloes.com.br` — 57 lotes identificados; parser, mídia,
  documentos e revalidação implementados. O acesso protegido pelo Cloudflare usa o
  FlareSolverr interno via `MILAN_FLARESOLVERR_URL`, com imagem ARM64.
- [x] **Leiloeiro Público** — `leiloeiropublico.com.br` — integração ASP.NET + API de
  lances; 992 imóveis identificados nos eventos publicados.
- [x] **Sato Leilões** — `satoleiloes.com.br` — integração Vue/Inertia; 126 imóveis,
  fotos e documentos identificados.
- [x] **Gilson Leilões** — `gilsonleiloes.com.br` — plataforma VLance; 6 imóveis ativos.
- [x] **JD Leilões** — `jdleiloes.com.br` — plataforma VLance; 10 imóveis ativos.
- [x] **Maria Fixer Leilões** — `mariafixerleiloes.com.br` — plataforma VLance;
  13 imóveis ativos.

## Pendentes

- [ ] **Dias Leilões** — https://www.diasleiloes.com.br/
- [ ] **Fábio Barbosa Leilões** — https://www.fabiobarbosaleiloes.com.br/
- [ ] **Insigne Leilões** — https://www.insigneleiloes.com.br/
- [ ] **Leilões Centro-Oeste** — https://www.leiloescentrooeste.com.br/
- [ ] **Leilões Zanoni** — https://www.leiloeszanoni.com.br/
- [ ] **Mato Grosso Leilões** — https://www.matogrossoleiloes.com.br/
- [ ] **Planalto Leilões** — https://www.planaltoleiloes.com.br/externo/
- [ ] **Verde Amarelo Leilões** — https://www.verdeamareloleiloes.com.br/
- [ ] **Verri Leilões** — https://www.verrileiloes.com.br/

## Integrações existentes fora da lista recebida

- [x] **Franco Leilões** — `francoleiloes.com.br` — 91 lotes

## Integrações de veículos existentes

Estas origens já fazem parte da ferramenta, mas não entram no backlog de imóveis acima:

- [x] Leilo — carros, motos e pesados
- [x] VIP Leilões — seminovos, usados, motos e pesados
- [x] Superbid — carros e motos

## Próximos lotes de implementação

Para reduzir risco, trabalhar em grupos pequenos e atualizar este arquivo ao final de cada publicação:

1. Selecionar de 1 a 4 sites pendentes.
2. Identificar a plataforma compartilhada e possíveis APIs.
3. Implementar catálogo, detalhe, mídia, documentos e revalidação.
4. Validar uma coleta completa localmente.
5. Publicar e acompanhar a primeira coleta em produção.
6. Marcar os itens concluídos e registrar qualquer limitação conhecida.
