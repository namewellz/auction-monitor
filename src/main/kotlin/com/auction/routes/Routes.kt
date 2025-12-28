package com.auction.routes

import com.auction.models.*
import com.auction.repositories.*
import com.auction.scheduler.MonitorScheduler
import com.auction.services.TelegramService
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.server.http.content.*

fun Application.configureRoutes() {
    val monitorConfigRepo = MonitorConfigRepository()
    val itemRepo = AuctionItemRepository()
    val priceHistoryRepo = PriceHistoryRepository()
    val telegramConfigRepo = TelegramConfigRepository()
    val telegramService = TelegramService(telegramConfigRepo)

    routing {
        // Serve arquivos estáticos
        staticResources("/", "static")

        // Monitor Configs
        route("/api/monitors") {
            get {
                call.respond(monitorConfigRepo.getAll())
            }

            get("/{id}") {
                val id = call.parameters["id"]?.toIntOrNull()
                if (id == null) {
                    call.respond(HttpStatusCode.BadRequest, "ID inválido")
                    return@get
                }

                val config = monitorConfigRepo.getById(id)
                if (config != null) {
                    call.respond(config)
                } else {
                    call.respond(HttpStatusCode.NotFound, "Monitor não encontrado")
                }
            }

            post {
                val config = call.receive<MonitorConfig>()
                val id = monitorConfigRepo.create(config)
                call.respond(HttpStatusCode.Created, mapOf("id" to id))
            }

            put("/{id}") {
                val id = call.parameters["id"]?.toIntOrNull()
                if (id == null) {
                    call.respond(HttpStatusCode.BadRequest, "ID inválido")
                    return@put
                }

                val config = call.receive<MonitorConfig>()
                val updated = monitorConfigRepo.update(id, config)

                if (updated) {
                    call.respond(HttpStatusCode.OK, mapOf("success" to true))
                } else {
                    call.respond(HttpStatusCode.NotFound, "Monitor não encontrado")
                }
            }

            delete("/{id}") {
                val id = call.parameters["id"]?.toIntOrNull()
                if (id == null) {
                    call.respond(HttpStatusCode.BadRequest, "ID inválido")
                    return@delete
                }

                val deleted = monitorConfigRepo.delete(id)
                if (deleted) {
                    call.respond(HttpStatusCode.OK, mapOf("success" to true))
                } else {
                    call.respond(HttpStatusCode.NotFound, "Monitor não encontrado")
                }
            }

            post("/{id}/run") {
                val id = call.parameters["id"]?.toIntOrNull()
                if (id == null) {
                    call.respond(HttpStatusCode.BadRequest, "ID inválido")
                    return@post
                }

                MonitorScheduler.runMonitorNow(id)
                call.respond(HttpStatusCode.OK, mapOf("success" to true, "message" to "Monitor executado"))
            }

            post("/test") {
                val config = call.receive<MonitorConfig>()

                try {
                    val superbidService = com.auction.services.SuperbidService()
                    val offers = superbidService.fetchOffers(config.url)

                    // Aplica filtros
                    val filteredOffers = if (config.keywords.isEmpty()) {
                        offers
                    } else {
                        offers.filter { offer ->
                            val title = offer.product?.shortDesc ?: ""
                            val description = offer.product?.detailedDescription ?: ""
                            val offerDesc = offer.offerDescription?.offerDescription ?: ""
                            val searchText = "$title $description $offerDesc".lowercase()

                            // Cada linha é processada independentemente (OR entre linhas)
                            config.keywords.any { line ->
                                val trimmedLine = line.trim()
                                if (trimmedLine.isEmpty()) return@any false

                                when {
                                    // Operador + = AND dentro da linha
                                    trimmedLine.contains("+") -> {
                                        val andTerms = trimmedLine.split("+").map { it.trim().lowercase() }
                                        andTerms.all { term ->
                                            term.isNotEmpty() && searchText.contains(term)
                                        }
                                    }
                                    // Operador ~ = OR dentro da linha
                                    trimmedLine.contains("~") -> {
                                        val orTerms = trimmedLine.split("~").map { it.trim().lowercase() }
                                        orTerms.any { term ->
                                            term.isNotEmpty() && searchText.contains(term)
                                        }
                                    }
                                    // Sem operador = termo simples
                                    else -> {
                                        searchText.contains(trimmedLine.lowercase())
                                    }
                                }
                            }
                        }
                    }

                    // Converte para formato simplificado
                    val results = filteredOffers.take(20).map { offer ->
                        mapOf(
                            "id" to offer.id,
                            "title" to (offer.product?.shortDesc ?: "Sem título"),
                            "price" to (offer.price ?: 0.0),
                            "imageUrl" to (offer.product?.thumbnailUrl ?: offer.product?.galleryJson?.firstOrNull()?.thumbnailUrl),
                            "lotNumber" to offer.lotNumber,
                            "categoryName" to offer.product?.subCategory?.category?.description,
                            "subCategoryName" to offer.product?.subCategory?.description,
                            "location" to offer.product?.location?.let { "${it.city ?: ""} - ${it.state ?: ""}" }?.trim(),
                            "seller" to offer.seller?.name,
                            "endDate" to offer.endDate,
                            "visits" to offer.visits
                        )
                    }

                    call.respond(mapOf(
                        "success" to true,
                        "totalFound" to offers.size,
                        "filteredCount" to filteredOffers.size,
                        "previewResults" to results,
                        "message" to "Encontrados ${filteredOffers.size} itens de ${offers.size} totais (mostrando até 20)"
                    ))

                } catch (e: Exception) {
                    call.respond(HttpStatusCode.InternalServerError, mapOf(
                        "success" to false,
                        "error" to (e.message ?: "Erro ao buscar ofertas"),
                        "message" to "Erro ao testar monitoramento. Verifique a URL e tente novamente."
                    ))
                }
            }
        }

        // Auction Items
        route("/api/items") {
            get {
                val archived = call.request.queryParameters["archived"]?.toBoolean() ?: false
                call.respond(itemRepo.getAll(archived))
            }

            get("/search") {
                val query = call.request.queryParameters["q"] ?: ""
                call.respond(itemRepo.search(query))
            }

            get("/{id}") {
                val id = call.parameters["id"]?.toIntOrNull()
                if (id == null) {
                    call.respond(HttpStatusCode.BadRequest, "ID inválido")
                    return@get
                }

                val item = itemRepo.findByOfferId(id.toString())
                if (item != null) {
                    call.respond(item)
                } else {
                    call.respond(HttpStatusCode.NotFound, "Item não encontrado")
                }
            }

            patch("/{id}/archive") {
                val id = call.parameters["id"]?.toIntOrNull()
                if (id == null) {
                    call.respond(HttpStatusCode.BadRequest, "ID inválido")
                    return@patch
                }

                val body = call.receive<Map<String, Boolean>>()
                val archived = body["archived"] ?: true

                val updated = itemRepo.archive(id, archived)
                if (updated) {
                    call.respond(HttpStatusCode.OK, mapOf("success" to true))
                } else {
                    call.respond(HttpStatusCode.NotFound, "Item não encontrado")
                }
            }
        }

        // Price History
        route("/api/history") {
            get("/{itemId}") {
                val itemId = call.parameters["itemId"]?.toIntOrNull()
                if (itemId == null) {
                    call.respond(HttpStatusCode.BadRequest, "ID inválido")
                    return@get
                }

                call.respond(priceHistoryRepo.getByItemId(itemId))
            }
        }

        // Telegram Config
        route("/api/telegram") {
            get {
                val config = telegramConfigRepo.getConfig()
                if (config != null) {
                    call.respond(config)
                } else {
                    call.respond(HttpStatusCode.NotFound, mapOf("message" to "Configuração não encontrada"))
                }
            }

            post {
                val config = call.receive<TelegramConfig>()
                telegramConfigRepo.createOrUpdate(config)
                telegramService.updateConfig(config)
                call.respond(HttpStatusCode.OK, mapOf("success" to true))
            }
        }

        // Health check
        get("/api/health") {
            call.respond(mapOf(
                "status" to "OK",
                "timestamp" to System.currentTimeMillis()
            ))
        }
    }
}