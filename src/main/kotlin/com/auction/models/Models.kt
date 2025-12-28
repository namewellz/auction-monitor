package com.auction.models

import kotlinx.serialization.Serializable
import java.time.LocalDateTime
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

@Serializable
data class MonitorConfig(
    val id: Int = 0,
    val name: String,
    val url: String,
    val keywords: List<String>,
    val keywordMode: String = "OR", // "OR" ou "AND"
    val intervalMinutes: Int,
    val active: Boolean = true
)

@Serializable
data class AuctionItem(
    val id: Int = 0,
    val offerId: String,
    val title: String,
    val description: String,
    val currentPrice: Double,
    val imageUrl: String?,
    val auctionUrl: String,
    val lotNumber: Int?,
    val endDate: String?,
    val visits: Int?,
    val categoryName: String?,
    val subCategoryName: String?,
    val location: String?,
    val seller: String?,
    val auctionName: String?,
    val auctioneer: String?,
    val monitorConfigId: Int,
    val archived: Boolean = false,
    @Serializable(with = LocalDateTimeSerializer::class)
    val createdAt: LocalDateTime = LocalDateTime.now(),
    @Serializable(with = LocalDateTimeSerializer::class)
    val updatedAt: LocalDateTime = LocalDateTime.now()
)

@Serializable
data class PriceHistory(
    val id: Int = 0,
    val auctionItemId: Int,
    val oldPrice: Double,
    val newPrice: Double,
    @Serializable(with = LocalDateTimeSerializer::class)
    val changedAt: LocalDateTime = LocalDateTime.now()
)

@Serializable
data class TelegramConfig(
    val id: Int = 0,
    val botToken: String,
    val chatId: String,
    val notifyNewItems: Boolean = true,
    val notifyPriceChanges: Boolean = true
)

// Modelos da API Superbid
@Serializable
data class SuperbidResponse(
    val total: Int? = null,
    val offers: List<SuperbidOffer> = emptyList()
)

@Serializable
data class SuperbidOffer(
    val id: Long,
    val lotNumber: Int? = null,
    val price: Double? = null,
    val endDate: String? = null,
    val visits: Int? = null,
    val product: SuperbidProduct? = null,
    val auction: SuperbidAuction? = null,
    val seller: SuperbidSeller? = null,
    val offerDescription: SuperbidOfferDescription? = null
)

@Serializable
data class SuperbidProduct(
    val productId: Long? = null,
    val shortDesc: String? = null,
    val thumbnailUrl: String? = null,
    val detailedDescription: String? = null,
    val galleryJson: List<SuperbidGalleryItem>? = null,
    val subCategory: SuperbidCategory? = null,
    val location: SuperbidLocation? = null
)

@Serializable
data class SuperbidGalleryItem(
    val link: String? = null,
    val thumbnailUrl: String? = null
)

@Serializable
data class SuperbidCategory(
    val description: String? = null,
    val category: SuperbidParentCategory? = null
)

@Serializable
data class SuperbidParentCategory(
    val description: String? = null
)

@Serializable
data class SuperbidLocation(
    val city: String? = null,
    val state: String? = null,
    val country: String? = null
)

@Serializable
data class SuperbidAuction(
    val id: Long? = null,
    val desc: String? = null,
    val modalityDesc: String? = null,
    val auctioneer: String? = null,
    val endDate: String? = null
)

@Serializable
data class SuperbidSeller(
    val name: String? = null,
    val city: String? = null
)

@Serializable
data class SuperbidOfferDescription(
    val offerDescription: String? = null
)

object LocalDateTimeSerializer : KSerializer<LocalDateTime> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("LocalDateTime", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: LocalDateTime) {
        encoder.encodeString(value.toString())
    }

    override fun deserialize(decoder: Decoder): LocalDateTime {
        return LocalDateTime.parse(decoder.decodeString())
    }
}