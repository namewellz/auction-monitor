package com.auction.database

import com.auction.models.*
import org.jetbrains.exposed.dao.id.IntIdTable
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.javatime.datetime
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.transactions.experimental.newSuspendedTransaction
import kotlinx.coroutines.Dispatchers
import java.time.LocalDateTime
import java.io.File

object MonitorConfigs : IntIdTable("monitor_configs") {
    val name = varchar("name", 255)
    val url = text("url")
    val keywords = text("keywords") // JSON array
    val keywordMode = varchar("keyword_mode", 10).default("OR")
    val intervalMinutes = integer("interval_minutes")
    val active = bool("active").default(true)
}

object AuctionItems : IntIdTable("auction_items") {
    val offerId = varchar("offer_id", 255).uniqueIndex()
    val title = text("title")
    val description = text("description")
    val currentPrice = double("current_price")
    val imageUrl = text("image_url").nullable()
    val auctionUrl = text("auction_url")
    val lotNumber = integer("lot_number").nullable()
    val endDate = varchar("end_date", 255).nullable()
    val visits = integer("visits").nullable()
    val categoryName = varchar("category_name", 255).nullable()
    val subCategoryName = varchar("sub_category_name", 255).nullable()
    val location = varchar("location", 500).nullable()
    val seller = varchar("seller", 500).nullable()
    val auctionName = varchar("auction_name", 500).nullable()
    val auctioneer = varchar("auctioneer", 500).nullable()
    val monitorConfigId = reference("monitor_config_id", MonitorConfigs)
    val archived = bool("archived").default(false)
    val createdAt = datetime("created_at").default(LocalDateTime.now())
    val updatedAt = datetime("updated_at").default(LocalDateTime.now())
}

object PriceHistories : IntIdTable("price_histories") {
    val auctionItemId = reference("auction_item_id", AuctionItems)
    val oldPrice = double("old_price")
    val newPrice = double("new_price")
    val changedAt = datetime("changed_at").default(LocalDateTime.now())
}

object TelegramConfigs : IntIdTable("telegram_configs") {
    val botToken = varchar("bot_token", 500)
    val chatId = varchar("chat_id", 255)
    val notifyNewItems = bool("notify_new_items").default(true)
    val notifyPriceChanges = bool("notify_price_changes").default(true)
}

object DatabaseFactory {
    fun init() {
        val driverClassName = "org.sqlite.JDBC"
        val jdbcURL = "jdbc:sqlite:./auction_monitor.db"

        val database = Database.connect(jdbcURL, driverClassName)

        println("Database path: ${File("./auction_monitor.db").absolutePath}")

        transaction(database) {
            SchemaUtils.create(
                MonitorConfigs,
                AuctionItems,
                PriceHistories,
                TelegramConfigs
            )

            // Cria índices para performance
            SchemaUtils.createMissingTablesAndColumns(
                AuctionItems,
                MonitorConfigs,
                PriceHistories,
                TelegramConfigs
            )
        }
    }

    // 👇 CORREÇÃO AQUI (linha ~80)
    suspend fun <T> dbQuery(block: suspend () -> T): T =
        newSuspendedTransaction(Dispatchers.IO) {
            block()
        }
}