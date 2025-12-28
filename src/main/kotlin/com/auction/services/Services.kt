package com.auction.services

import com.auction.models.*
import com.auction.repositories.*
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json

class SuperbidService {
    private val client = HttpClient(CIO) {
        install(ContentNegotiation) {
            json(Json {
                ignoreUnknownKeys = true
                isLenient = true
            })
        }
    }

    suspend fun fetchOffers(url: String): List<SuperbidOffer> {
        return try {
            val response = client.get(url)
            val data: SuperbidResponse = response.body()
            println("Total de ofertas retornadas: ${data.offers.size}")
            data.offers
        } catch (e: Exception) {
            println("Erro ao buscar ofertas: ${e.message}")
            e.printStackTrace()
            emptyList()
        }
    }
}

class MonitorService(
    private val superbidService: SuperbidService,
    private val itemRepository: AuctionItemRepository,
    private val priceHistoryRepository: PriceHistoryRepository,
    private val telegramService: TelegramService
) {
    suspend fun processMonitor(config: MonitorConfig) {
        println("Processando monitor: ${config.name}")

        val offers = superbidService.fetchOffers(config.url)
        val filteredOffers = filterByKeywords(offers, config.keywords, config.keywordMode)

        println("Encontrados ${filteredOffers.size} itens após filtro de palavras-chave (de ${offers.size} totais)")

        for (offer in filteredOffers) {
            processOffer(offer, config.id)
        }
    }

    private fun filterByKeywords(
        offers: List<SuperbidOffer>,
        keywords: List<String>,
        mode: String
    ): List<SuperbidOffer> {
        if (keywords.isEmpty()) return offers

        return offers.filter { offer ->
            val title = offer.product?.shortDesc ?: ""
            val description = offer.product?.detailedDescription ?: ""
            val offerDesc = offer.offerDescription?.offerDescription ?: ""

            val searchText = "$title $description $offerDesc".lowercase()

            // Processa grupos AND separados por vírgula
            val keywordGroups = keywords.map { it.trim() }

            when (mode.uppercase()) {
                "AND" -> {
                    // Modo AND: TODOS os grupos devem ter match
                    keywordGroups.all { group ->
                        if (group.contains("+")) {
                            // Grupo com OR interno (ex: "storage+disco")
                            val orTerms = group.split("+").map { it.trim().lowercase() }
                            orTerms.any { term -> searchText.contains(term) }
                        } else {
                            // Termo simples
                            searchText.contains(group.lowercase())
                        }
                    }
                }
                "OR" -> {
                    // Modo OR: QUALQUER grupo deve ter match
                    keywordGroups.any { group ->
                        if (group.contains("+")) {
                            // Grupo com OR interno (ex: "storage+disco")
                            val orTerms = group.split("+").map { it.trim().lowercase() }
                            orTerms.any { term -> searchText.contains(term) }
                        } else {
                            // Termo simples
                            searchText.contains(group.lowercase())
                        }
                    }
                }
                else -> false
            }
        }
    }

    private suspend fun processOffer(offer: SuperbidOffer, monitorConfigId: Int) {
        val offerId = offer.id.toString()
        val existingItem = itemRepository.findByOfferId(offerId)

        val title = offer.product?.shortDesc ?: "Sem título"
        val description = offer.offerDescription?.offerDescription ?:
        offer.product?.detailedDescription ?: ""
        val price = offer.price ?: 0.0
        val imageUrl = offer.product?.thumbnailUrl ?:
        offer.product?.galleryJson?.firstOrNull()?.thumbnailUrl

        // Monta URL do leilão
        val auctionUrl = "https://exchange.superbid.net/leilao/${offer.id}"

        // Dados adicionais
        val location = offer.product?.location?.let { loc ->
            "${loc.city ?: ""} - ${loc.state ?: ""}"
        }?.trim()?.takeIf { it.isNotBlank() }

        val categoryName = offer.product?.subCategory?.category?.description
        val subCategoryName = offer.product?.subCategory?.description
        val seller = offer.seller?.name
        val auctionName = offer.auction?.desc
        val auctioneer = offer.auction?.auctioneer

        if (existingItem == null) {
            // Novo item
            val newItem = AuctionItem(
                offerId = offerId,
                title = title,
                description = description,
                currentPrice = price,
                imageUrl = imageUrl,
                auctionUrl = auctionUrl,
                lotNumber = offer.lotNumber,
                endDate = offer.endDate,
                visits = offer.visits,
                categoryName = categoryName,
                subCategoryName = subCategoryName,
                location = location,
                seller = seller,
                auctionName = auctionName,
                auctioneer = auctioneer,
                monitorConfigId = monitorConfigId
            )

            val itemId = itemRepository.create(newItem)
            println("✅ Novo item criado: $title (ID: $itemId)")

            // Notifica via Telegram
            telegramService.notifyNewItem(newItem.copy(id = itemId))
        } else {
            // Item existente - verifica mudança de preço
            if (price != existingItem.currentPrice && price > 0) {
                itemRepository.updatePrice(existingItem.id, price)

                // Salva histórico
                priceHistoryRepository.create(
                    PriceHistory(
                        auctionItemId = existingItem.id,
                        oldPrice = existingItem.currentPrice,
                        newPrice = price
                    )
                )

                println("💰 Preço atualizado: $title - R$ ${existingItem.currentPrice} → R$ $price")

                // Notifica mudança de preço
                telegramService.notifyPriceChange(
                    existingItem.copy(currentPrice = price),
                    existingItem.currentPrice,
                    price
                )
            }
        }
    }
}

class TelegramService(private val configRepository: TelegramConfigRepository) {
    private var bot: com.pengrad.telegrambot.TelegramBot? = null
    private var chatId: String? = null

    init {
        val config = configRepository.getConfig()
        if (config != null) {
            bot = com.pengrad.telegrambot.TelegramBot(config.botToken)
            chatId = config.chatId
        }
    }

    fun updateConfig(config: TelegramConfig) {
        bot = com.pengrad.telegrambot.TelegramBot(config.botToken)
        chatId = config.chatId
    }

    fun notifyNewItem(item: AuctionItem) {
        val config = configRepository.getConfig()
        if (config?.notifyNewItems != true) return

        val message = buildString {
            appendLine("🆕 *NOVO ITEM ENCONTRADO*")
            appendLine()
            appendLine("*${escapeMarkdown(item.title)}*")
            appendLine()
            appendLine("💰 Preço: R$ ${String.format("%.2f", item.currentPrice)}")

            if (item.lotNumber != null) {
                appendLine("🎯 Lote: ${item.lotNumber}")
            }
            if (item.categoryName != null) {
                appendLine("🏷️ ${item.categoryName}${item.subCategoryName?.let { " > $it" } ?: ""}")
            }
            if (item.location != null) {
                appendLine("📍 ${item.location}")
            }
            if (item.seller != null) {
                appendLine("🏢 ${escapeMarkdown(item.seller)}")
            }
            if (item.auctionName != null) {
                appendLine("📋 Leilão: ${escapeMarkdown(item.auctionName)}")
            }
            if (item.endDate != null) {
                appendLine("⏰ Encerramento: ${item.endDate}")
            }
            if (item.visits != null) {
                appendLine("👁️ Visitas: ${item.visits}")
            }

            appendLine()
            appendLine("🔗 ${item.auctionUrl}")
        }

        sendMessage(message)
    }

    fun notifyPriceChange(item: AuctionItem, oldPrice: Double, newPrice: Double) {
        val config = configRepository.getConfig()
        if (config?.notifyPriceChanges != true) return

        val priceChange = newPrice - oldPrice
        val percentChange = (priceChange / oldPrice) * 100
        val emoji = if (priceChange > 0) "📈" else "📉"

        val message = buildString {
            appendLine("$emoji *MUDANÇA DE PREÇO*")
            appendLine()
            appendLine("*${escapeMarkdown(item.title)}*")
            appendLine()
            appendLine("💰 De: R$ ${String.format("%.2f", oldPrice)}")
            appendLine("💰 Para: R$ ${String.format("%.2f", newPrice)}")
            appendLine("📊 Variação: R$ ${String.format("%.2f", priceChange)} (${String.format("%.1f", percentChange)}%)")

            if (item.lotNumber != null) {
                appendLine("🎯 Lote: ${item.lotNumber}")
            }

            appendLine()
            appendLine("🔗 ${item.auctionUrl}")
        }

        sendMessage(message)
    }

    private fun escapeMarkdown(text: String): String {
        return text.replace("_", "\\_")
            .replace("*", "\\*")
            .replace("[", "\\[")
            .replace("]", "\\]")
            .replace("(", "\\(")
            .replace(")", "\\)")
            .replace("~", "\\~")
            .replace("`", "\\`")
            .replace(">", "\\>")
            .replace("#", "\\#")
            .replace("+", "\\+")
            .replace("-", "\\-")
            .replace("=", "\\=")
            .replace("|", "\\|")
            .replace("{", "\\{")
            .replace("}", "\\}")
            .replace(".", "\\.")
            .replace("!", "\\!")
    }

    private fun sendMessage(text: String) {
        try {
            if (bot != null && chatId != null) {
                val request = com.pengrad.telegrambot.request.SendMessage(chatId, text)
                    .parseMode(com.pengrad.telegrambot.model.request.ParseMode.Markdown)
                val response = bot?.execute(request)

                if (response?.isOk == true) {
                    println("✉️ Mensagem Telegram enviada com sucesso")
                } else {
                    println("⚠️ Erro ao enviar mensagem Telegram: ${response?.description()}")
                }
            }
        } catch (e: Exception) {
            println("❌ Erro ao enviar mensagem Telegram: ${e.message}")
            e.printStackTrace()
        }
    }
}