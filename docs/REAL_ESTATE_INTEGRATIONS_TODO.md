# Backlog de integrações de leilões de imóveis

Última revisão: 24/07/2026

Este arquivo é a fonte de acompanhamento dos sites de imóveis que devem entrar no Auction Data.
A lista recebida continha 85 ocorrências, sendo 43 domínios únicos após remover duplicidades e
parâmetros de rastreamento (`utm_*`).

## Resumo

- Total da lista: **43 sites**
- Integrados no código: **18**
- Pendentes: **25**
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

## Pendentes

- [ ] **DM Leilões Judiciais** — https://www.dmleiloesjudiciais.com.br/externo/ — domínio redireciona atualmente para Rosi Oliveira Leilões; validar identidade antes de integrar
- [ ] **Dias Leilões** — https://www.diasleiloes.com.br/
- [ ] **Fábio Barbosa Leilões** — https://www.fabiobarbosaleiloes.com.br/
- [ ] **Fábio Leilões** — https://www.fabioleiloes.com.br/
- [ ] **Fidelis Leilões** — http://www.fidelisleiloes.com.br/
- [ ] **Galvani Leilões** — https://www.galvanileiloes.com.br/
- [ ] **Gilson Leilões** — https://gilsonleiloes.com.br/
- [ ] **Insigne Leilões** — https://www.insigneleiloes.com.br/
- [ ] **JD Leilões** — https://www.jdleiloes.com.br/
- [ ] **José Rodovalho Leilões** — https://www.joserodovalholeiloes.com.br/
- [ ] **Leilões Centro-Oeste** — https://www.leiloescentrooeste.com.br/
- [ ] **Leilões Judiciais Bahia** — https://www.leiloesjudiciaisbahia.com.br/externo/
- [ ] **Leilões Zanoni** — https://www.leiloeszanoni.com.br/
- [ ] **Maria Fixer Leilões** — https://www.mariafixerleiloes.com.br/
- [ ] **Mato Grosso Leilões** — https://www.matogrossoleiloes.com.br/
- [ ] **Milan Leilões** — https://www.milanleiloes.com.br/
- [ ] **Planalto Leilões** — https://www.planaltoleiloes.com.br/externo/
- [ ] **Rigolon Leilões** — https://www.rigolonleiloes.com.br/externo
- [ ] **Leiloeiro Público** — https://www.leiloeiropublico.com.br/
- [ ] **Sato Leilões** — https://www.satoleiloes.com.br/
- [ ] **Thaís Teixeira Leilões** — https://www.thaisteixeiraleiloes.com.br/externo/
- [ ] **TRI Leilões** — https://www.trileiloes.com.br/
- [ ] **Valero Leilões** — https://www.valeroleiloes.com.br/
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
