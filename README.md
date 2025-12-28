# 🔍 Sistema de Monitoramento de Leilões Superbid

Sistema completo em Kotlin para monitoramento automatizado de leilões online da plataforma Superbid, com notificações via Telegram e interface web para gerenciamento.

## 📋 Funcionalidades

### Monitoramento Automático
- ✅ Consulta periódica configurável (intervalo em minutos)
- ✅ Atualização automática de preços
- ✅ **Sistema avançado de filtros com AND/OR**
- ✅ **Operador `+` para OR dentro da mesma linha**
- ✅ Suporte para múltiplas URLs, cada uma com seu grupo de palavras-chave
- ✅ Ativação/desativação de monitoramentos

### Gerenciamento de Dados
- ✅ Persistência em SQLite
- ✅ Histórico completo de alterações de preço
- ✅ Deduplicação automática por `offerId`
- ✅ Arquivamento de anúncios (não aparecem na listagem principal)
- ✅ Busca e filtros

### Interface Web
- ✅ Configuração de monitoramentos (URL + palavras-chave)
- ✅ Listagem de anúncios com fotos
- ✅ Visualização de anúncios arquivados
- ✅ Busca em tempo real
- ✅ Arquivamento/restauração de itens

### Notificações Telegram
- ✅ Alertas de novos itens encontrados
- ✅ Alertas de mudanças de preço
- ✅ Configuração de bot e chat ID
- ✅ Ativação/desativação de tipos de notificação

## 🏗️ Arquitetura

### Backend (Kotlin)
```
com.auction
├── models/          # Modelos de dados
├── database/        # Configuração SQLite + Exposed
├── repositories/    # Acesso aos dados
├── services/        # Lógica de negócio
├── scheduler/       # Agendamento de tarefas
└── routes/          # REST API endpoints
```

### Frontend (HTML/CSS/JS)
- Interface single-page com tabs
- Comunicação via REST API
- Design responsivo e moderno

### Database (SQLite)
- `monitor_configs` - Configurações de monitoramento
- `auction_items` - Itens capturados
- `price_histories` - Histórico de preços
- `telegram_configs` - Configuração do Telegram

## 🚀 Instalação e Configuração

### 1. Pré-requisitos
- JDK 17 ou superior
- Gradle 8.x

### 2. Estrutura do Projeto
```
auction-monitor/
├── build.gradle.kts
├── src/
│   ├── main/
│   │   ├── kotlin/
│   │   │   └── com/auction/
│   │   │       ├── Application.kt
│   │   │       ├── models/
│   │   │       │   └── Models.kt
│   │   │       ├── database/
│   │   │       │   └── DatabaseFactory.kt
│   │   │       ├── repositories/
│   │   │       │   └── Repositories.kt
│   │   │       ├── services/
│   │   │       │   └── Services.kt
│   │   │       ├── scheduler/
│   │   │       │   └── MonitorScheduler.kt
│   │   │       └── routes/
│   │   │           └── Routes.kt
│   │   └── resources/
│   │       └── static/
│   │           └── index.html
└── README.md
```

### 3. Criar o Projeto

```bash
# Criar diretório do projeto
mkdir auction-monitor
cd auction-monitor

# Criar estrutura de diretórios
mkdir -p src/main/kotlin/com/auction/{models,database,repositories,services,scheduler,routes}
mkdir -p src/main/resources/static

# Copiar os arquivos fornecidos para os diretórios correspondentes
```

### 4. Compilar e Executar

```bash
# Compilar o projeto
./gradlew build

# Executar o servidor
./gradlew run
```

O servidor estará disponível em `http://localhost:8080`

### 5. Configurar o Bot do Telegram

1. Abra o Telegram e procure por **@BotFather**
2. Envie o comando `/newbot`
3. Siga as instruções para criar seu bot
4. Copie o **token** fornecido
5. Para obter o Chat ID:
    - Adicione seu bot ao grupo desejado
    - Envie uma mensagem no grupo
    - Acesse: `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates`
    - Procure pelo campo `"chat":{"id":...}`
6. Configure no frontend (aba Telegram)

## 📖 Como Usar

### 1. Criar um Monitoramento

1. Acesse `http://localhost:8080`
2. Vá para a aba **Monitoramentos**
3. Clique em **➕ Novo Monitoramento**
4. Preencha:
    - **Nome**: Ex: "Storage Alta Capacidade"
    - **URL**: Cole a URL completa da API Superbid
    - **Palavras-chave**: Digite uma por linha
    - **Modo de Busca**:
        - **OR**: Encontra itens com QUALQUER palavra-chave
        - **AND**: Encontra itens com TODAS as palavras-chave
    - **Intervalo**: Tempo em minutos entre verificações
    - **Ativo**: Marque para ativar imediatamente
5. **🔍 TESTE SEUS FILTROS** antes de salvar! (recomendado)
6. Clique em **💾 Salvar**

#### 🔍 Testar Filtros Antes de Salvar (Novo!)

Antes de salvar, clique em **"🔍 Testar Filtros"** para:
- ✅ Ver quantos itens serão encontrados
- ✅ Prévia de até 20 resultados com fotos
- ✅ Taxa de match (% de itens filtrados)
- ✅ Dicas automáticas de otimização

**Exemplo de resultado:**
```
Total Retornado: 1465
Após Filtros: 48 (3.3%)
✅ Resultado parece bom! Você pode salvar o monitoramento agora.

Prévia: [20 primeiros itens com fotos e detalhes]
```

**Taxa ideal:** 1-5% para monitoramento focado

#### Sintaxe de Palavras-Chave

Use o operador `+` para criar grupos OR dentro da mesma linha:

```
# Modo AND - Todas as linhas devem ter match
storage + disco + hd       # Linha 1: storage OU disco OU hd
tb + terabyte              # Linha 2: tb OU terabyte
raid + san + nas           # Linha 3: raid OU san OU nas
```

**Resultado:** Encontra itens que tenham **(storage OU disco OU hd)** E **(tb OU terabyte)** E **(raid OU san OU nas)**

```
# Modo OR - Qualquer linha deve ter match
notebook + laptop          # Qualquer um desses
tablet + ipad              # OU qualquer um desses
celular + smartphone       # OU qualquer um desses
```

**Resultado:** Encontra itens que tenham **qualquer** dessas combinações

### 2. URL de Exemplo da Superbid

```
https://offer-query.superbid.net/seo/offers/?filter=auction.modalityDesc:leilao&locale=pt_BR&orderBy=score:desc&pageNumber=1&pageSize=3000&portalId=[2,15]&preOrderBy=orderByFirstOpenedOffersAndSecondHasPhoto&requestOrigin=marketplace&searchType=opened&timeZoneId=America/Sao_Paulo&urlSeo=https://exchange.superbid.net/categorias/tecnologia
```

### 3. Visualizar Anúncios

- **Aba Anúncios**: Mostra todos os itens não arquivados
- **Aba Arquivados**: Mostra itens que você arquivou
- Use a busca para filtrar por título ou descrição
- Clique em **Ver Leilão** para abrir o item no site da Superbid
- Clique em **📦 Arquivar** para ocultar da listagem principal

### 4. Configurar Notificações

1. Vá para a aba **Telegram**
2. Cole o **Bot Token** e **Chat ID**
3. Marque as opções de notificação desejadas:
    - Notificar novos itens
    - Notificar mudanças de preço
4. Clique em **💾 Salvar Configuração**

## 🔧 API Endpoints

### Monitoramentos
- `GET /api/monitors` - Listar todos
- `GET /api/monitors/{id}` - Obter por ID
- `POST /api/monitors` - Criar novo
- `PUT /api/monitors/{id}` - Atualizar
- `DELETE /api/monitors/{id}` - Excluir
- `POST /api/monitors/{id}/run` - Executar manualmente

### Itens
- `GET /api/items?archived=false` - Listar itens
- `GET /api/items/search?q=termo` - Buscar
- `GET /api/items/{id}` - Obter por ID
- `PATCH /api/items/{id}/archive` - Arquivar/Restaurar

### Histórico de Preços
- `GET /api/history/{itemId}` - Obter histórico de um item

### Telegram
- `GET /api/telegram` - Obter configuração
- `POST /api/telegram` - Criar/Atualizar configuração

### Health Check
- `GET /api/health` - Status do servidor

## 📊 Modelo de Dados

### MonitorConfig
```kotlin
{
  "id": 1,
  "name": "Tecnologia",
  "url": "https://offer-query.superbid.net/...",
  "keywords": ["notebook", "iphone"],
  "intervalMinutes": 15,
  "active": true
}
```

### AuctionItem
```kotlin
{
  "id": 1,
  "offerId": "12345",
  "title": "Notebook Dell i7",
  "description": "...",
  "currentPrice": 2500.00,
  "imageUrl": "https://...",
  "auctionUrl": "https://...",
  "modalityDesc": "Leilão Online",
  "categoryName": "Informática",
  "endDate": "2025-01-15T18:00:00",
  "monitorConfigId": 1,
  "archived": false,
  "createdAt": "2025-01-01T10:00:00",
  "updatedAt": "2025-01-01T10:00:00"
}
```

### TelegramConfig
```kotlin
{
  "id": 1,
  "botToken": "123456:ABC-DEF...",
  "chatId": "-1001234567890",
  "notifyNewItems": true,
  "notifyPriceChanges": true
}
```

## 🎯 Fluxo de Funcionamento

1. **Scheduler** inicia e carrega todos os monitoramentos ativos
2. Para cada monitoramento:
    - Aguarda o intervalo configurado
    - Faz requisição para a URL da Superbid
    - **Aplica filtros avançados (AND/OR com grupos +)**
    - Para cada item encontrado:
        - Verifica se já existe no banco (por `offerId`)
        - Se novo: salva e notifica via Telegram
        - Se existente: verifica mudança de preço
            - Se preço mudou: atualiza, salva histórico, notifica
3. Frontend consulta a API para exibir os dados
4. Usuário pode arquivar itens manualmente

## 🔍 Sistema de Filtros

### Operadores

- **Modo OR**: Item precisa ter **pelo menos UMA** linha de palavras-chave
- **Modo AND**: Item precisa ter **TODAS** as linhas de palavras-chave
- **Operador `+`**: Cria OR dentro da mesma linha

### Exemplos Práticos

**Exemplo 1: Storage Enterprise (AND)**
```
Modo: AND
storage + disco + hd
tb + terabyte
enterprise + raid
```
Encontra: Storages/discos de alta capacidade enterprise

**Exemplo 2: Notebooks Gamer (AND)**
```
Modo: AND
notebook + laptop
i7 + i9 + ryzen
rtx + radeon
```
Encontra: Notebooks com processadores e placas de vídeo potentes

**Exemplo 3: Tech Geral (OR)**
```
Modo: OR
notebook
celular + smartphone
tablet
monitor
```
Encontra: Qualquer um desses tipos de produto

## 🐛 Troubleshooting

### Erro ao conectar com o banco
- Verifique se o diretório tem permissões de escrita
- O arquivo `auction_monitor.db` será criado automaticamente

### Notificações não chegam no Telegram
- Verifique se o bot foi adicionado ao grupo
- Confirme que o Chat ID está correto
- Teste enviando uma mensagem manual para o bot

### Monitoramento não está executando
- Verifique se está marcado como "Ativo"
- Confira os logs do servidor para erros
- Use o botão "▶️ Executar Agora" para testar

### Erro ao buscar ofertas da Superbid
- Verifique se a URL está correta
- A API da Superbid pode ter mudado
- Verifique sua conexão com a internet

## 📝 Notas Importantes

- O banco SQLite é criado no diretório de execução
- Os monitoramentos executam em coroutines independentes
- O intervalo mínimo recomendado é 5 minutos para evitar sobrecarga
- Palavras-chave não diferenciam maiúsculas/minúsculas
- URLs longas devem ser coladas completas no campo de texto

## 🔐 Segurança

- ⚠️ Não exponha o servidor diretamente na internet sem autenticação
- ⚠️ Proteja o token do Telegram Bot
- ⚠️ Para produção, considere adicionar HTTPS e autenticação

## 📈 Melhorias Futuras

- [ ] Autenticação de usuários
- [ ] Gráficos de histórico de preços
- [ ] Exportação de dados (CSV, Excel)
- [ ] Notificações por email
- [ ] Dashboard com estatísticas
- [ ] Suporte a múltiplos sites de leilão
- [ ] Alertas personalizados (preço máximo, etc)

## 📄 Licença

Este projeto é fornecido como exemplo educacional.

## 👨‍💻 Desenvolvimento

Desenvolvido com:
- Kotlin 1.9+
- Ktor 2.3+
- Exposed ORM
- SQLite
- Telegram Bot API
- HTML/CSS/JavaScript

---

**Dúvidas ou problemas?** Abra uma issue ou entre em contato!