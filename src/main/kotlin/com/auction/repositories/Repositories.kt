package com.auction.repositories

import com.auction.database.*
import com.auction.models.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.transactions.transaction
import java.time.LocalDateTime

class MonitorConfigRepository {
    fun create(config: MonitorConfig): Int = transaction {
        MonitorConfigs.insert {
            it[name] = config.name
            it[url] = config.url
            it[keywords] = Json.encodeToString(config.keywords)
            it[keywordMode] = config.keywordMode
            it[intervalMinutes] = config.intervalMinutes
            it[active] = config.active
        }[MonitorConfigs.id].value
    }

    fun getAll(): List<MonitorConfig> = transaction {
        MonitorConfigs.selectAll().map { rowToConfig(it) }
    }

    fun getById(id: Int): MonitorConfig? = transaction {
        MonitorConfigs.select { MonitorConfigs.id eq id }
            .mapNotNull { rowToConfig(it) }
            .singleOrNull()
    }

    fun getActive(): List<MonitorConfig> = transaction {
        MonitorConfigs.select { MonitorConfigs.active eq true }
            .map { rowToConfig(it) }
    }

    fun update(id: Int, config: MonitorConfig): Boolean = transaction {
        MonitorConfigs.update({ MonitorConfigs.id eq id }) {
            it[name] = config.name
            it[url] = config.url
            it[keywords] = Json.encodeToString(config.keywords)
            it[keywordMode] = config.keywordMode
            it[intervalMinutes] = config.intervalMinutes
            it[active] = config.active
        } > 0
    }

    fun delete(id: Int): Boolean = transaction {
        MonitorConfigs.deleteWhere { MonitorConfigs.id eq id } > 0
    }

    private fun rowToConfig(row: ResultRow) = MonitorConfig(
        id = row[MonitorConfigs.id].value,
        name = row[MonitorConfigs.name],
        url = row[MonitorConfigs.url],
        keywords = Json.decodeFromString(row[MonitorConfigs.keywords]),
        keywordMode = row[MonitorConfigs.keywordMode],
        intervalMinutes = row[MonitorConfigs.intervalMinutes],
        active = row[MonitorConfigs.active]
    )
}

class AuctionItemRepository {
    fun create(item: AuctionItem): Int = transaction {
        AuctionItems.insert {
            it[offerId] = item.offerId
            it[title] = item.title
            it[description] = item.description
            it[currentPrice] = item.currentPrice
            it[imageUrl] = item.imageUrl
            it[auctionUrl] = item.auctionUrl
            it[lotNumber] = item.lotNumber
            it[endDate] = item.endDate
            it[visits] = item.visits
            it[categoryName] = item.categoryName
            it[subCategoryName] = item.subCategoryName
            it[location] = item.location
            it[seller] = item.seller
            it[auctionName] = item.auctionName
            it[auctioneer] = item.auctioneer
            it[monitorConfigId] = item.monitorConfigId
            it[archived] = item.archived
            it[createdAt] = LocalDateTime.now()
            it[updatedAt] = LocalDateTime.now()
        }[AuctionItems.id].value
    }

    fun findByOfferId(offerId: String): AuctionItem? = transaction {
        AuctionItems.select { AuctionItems.offerId eq offerId }
            .mapNotNull { rowToItem(it) }
            .singleOrNull()
    }

    fun updatePrice(id: Int, newPrice: Double): Boolean = transaction {
        AuctionItems.update({ AuctionItems.id eq id }) {
            it[currentPrice] = newPrice
            it[updatedAt] = LocalDateTime.now()
        } > 0
    }

    fun getAll(archived: Boolean = false): List<AuctionItem> = transaction {
        AuctionItems.select { AuctionItems.archived eq archived }
            .orderBy(AuctionItems.updatedAt to SortOrder.DESC)
            .map { rowToItem(it) }
    }

    fun archive(id: Int, archived: Boolean = true): Boolean = transaction {
        AuctionItems.update({ AuctionItems.id eq id }) {
            it[AuctionItems.archived] = archived
            it[updatedAt] = LocalDateTime.now()
        } > 0
    }

    fun search(query: String): List<AuctionItem> = transaction {
        AuctionItems.select {
            (AuctionItems.title like "%$query%") or
                    (AuctionItems.description like "%$query%")
        }.map { rowToItem(it) }
    }

    private fun rowToItem(row: ResultRow) = AuctionItem(
        id = row[AuctionItems.id].value,
        offerId = row[AuctionItems.offerId],
        title = row[AuctionItems.title],
        description = row[AuctionItems.description],
        currentPrice = row[AuctionItems.currentPrice],
        imageUrl = row[AuctionItems.imageUrl],
        auctionUrl = row[AuctionItems.auctionUrl],
        lotNumber = row[AuctionItems.lotNumber],
        endDate = row[AuctionItems.endDate],
        visits = row[AuctionItems.visits],
        categoryName = row[AuctionItems.categoryName],
        subCategoryName = row[AuctionItems.subCategoryName],
        location = row[AuctionItems.location],
        seller = row[AuctionItems.seller],
        auctionName = row[AuctionItems.auctionName],
        auctioneer = row[AuctionItems.auctioneer],
        monitorConfigId = row[AuctionItems.monitorConfigId].value,
        archived = row[AuctionItems.archived],
        createdAt = row[AuctionItems.createdAt],
        updatedAt = row[AuctionItems.updatedAt]
    )
}

class PriceHistoryRepository {
    fun create(history: PriceHistory): Int = transaction {
        PriceHistories.insert {
            it[auctionItemId] = history.auctionItemId
            it[oldPrice] = history.oldPrice
            it[newPrice] = history.newPrice
            it[changedAt] = LocalDateTime.now()
        }[PriceHistories.id].value
    }

    fun getByItemId(itemId: Int): List<PriceHistory> = transaction {
        PriceHistories.select { PriceHistories.auctionItemId eq itemId }
            .orderBy(PriceHistories.changedAt to SortOrder.DESC)
            .map { rowToHistory(it) }
    }

    private fun rowToHistory(row: ResultRow) = PriceHistory(
        id = row[PriceHistories.id].value,
        auctionItemId = row[PriceHistories.auctionItemId].value,
        oldPrice = row[PriceHistories.oldPrice],
        newPrice = row[PriceHistories.newPrice],
        changedAt = row[PriceHistories.changedAt]
    )
}

class TelegramConfigRepository {
    fun getConfig(): TelegramConfig? = transaction {
        TelegramConfigs.selectAll()
            .mapNotNull { rowToConfig(it) }
            .singleOrNull()
    }

    fun createOrUpdate(config: TelegramConfig): Int = transaction {
        val existing = TelegramConfigs.selectAll().singleOrNull()

        if (existing != null) {
            TelegramConfigs.update {
                it[botToken] = config.botToken
                it[chatId] = config.chatId
                it[notifyNewItems] = config.notifyNewItems
                it[notifyPriceChanges] = config.notifyPriceChanges
            }
            existing[TelegramConfigs.id].value
        } else {
            TelegramConfigs.insert {
                it[botToken] = config.botToken
                it[chatId] = config.chatId
                it[notifyNewItems] = config.notifyNewItems
                it[notifyPriceChanges] = config.notifyPriceChanges
            }[TelegramConfigs.id].value
        }
    }

    private fun rowToConfig(row: ResultRow) = TelegramConfig(
        id = row[TelegramConfigs.id].value,
        botToken = row[TelegramConfigs.botToken],
        chatId = row[TelegramConfigs.chatId],
        notifyNewItems = row[TelegramConfigs.notifyNewItems],
        notifyPriceChanges = row[TelegramConfigs.notifyPriceChanges]
    )
}