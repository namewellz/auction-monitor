package com.auction.scheduler

import com.auction.repositories.*
import com.auction.services.*
import kotlinx.coroutines.*
import java.time.LocalDateTime
import java.util.concurrent.ConcurrentHashMap

object MonitorScheduler {
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val activeJobs = ConcurrentHashMap<Int, Job>()

    private val superbidService = SuperbidService()
    private val itemRepository = AuctionItemRepository()
    private val priceHistoryRepository = PriceHistoryRepository()
    private val telegramConfigRepository = TelegramConfigRepository()
    private val telegramService = TelegramService(telegramConfigRepository)
    private val monitorConfigRepository = MonitorConfigRepository()

    private val monitorService = MonitorService(
        superbidService,
        itemRepository,
        priceHistoryRepository,
        telegramService
    )

    fun start() {
        println("Iniciando MonitorScheduler...")

        scope.launch {
            while (isActive) {
                try {
                    updateSchedules()
                    delay(60_000) // Verifica a cada 1 minuto por novos configs ou mudanças
                } catch (e: Exception) {
                    println("Erro no scheduler: ${e.message}")
                    e.printStackTrace()
                }
            }
        }
    }

    private suspend fun updateSchedules() {
        val activeConfigs = monitorConfigRepository.getActive()

        // Remove jobs de configs que não existem mais ou foram desativados
        activeJobs.keys.forEach { configId ->
            if (activeConfigs.none { it.id == configId }) {
                activeJobs[configId]?.cancel()
                activeJobs.remove(configId)
                println("Job removido para config ID: $configId")
            }
        }

        // Adiciona ou atualiza jobs para configs ativos
        activeConfigs.forEach { config ->
            if (!activeJobs.containsKey(config.id)) {
                startMonitorJob(config)
            } else {
                // Verifica se o intervalo mudou
                val currentJob = activeJobs[config.id]
                if (currentJob != null && !currentJob.isActive) {
                    activeJobs.remove(config.id)
                    startMonitorJob(config)
                }
            }
        }
    }

    private fun startMonitorJob(config: com.auction.models.MonitorConfig) {
        val job = scope.launch {
            println("Iniciando job para monitor: ${config.name} (a cada ${config.intervalMinutes} minutos)")

            while (isActive) {
                try {
                    println("[${LocalDateTime.now()}] Executando monitor: ${config.name}")
                    monitorService.processMonitor(config)
                    println("[${LocalDateTime.now()}] Monitor finalizado: ${config.name}")
                } catch (e: Exception) {
                    println("Erro ao processar monitor ${config.name}: ${e.message}")
                    e.printStackTrace()
                }

                delay(config.intervalMinutes * 60_000L)
            }
        }

        activeJobs[config.id] = job
    }

    fun stop() {
        println("Parando MonitorScheduler...")
        activeJobs.values.forEach { it.cancel() }
        activeJobs.clear()
        scope.cancel()
    }

    // Permite executar um monitor manualmente
    suspend fun runMonitorNow(configId: Int) {
        val config = monitorConfigRepository.getById(configId)
        if (config != null) {
            println("Executando monitor manualmente: ${config.name}")
            monitorService.processMonitor(config)
        }
    }
}