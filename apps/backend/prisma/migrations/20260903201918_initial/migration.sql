-- CreateTable
CREATE TABLE `servers` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `host` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `applications` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `serverId` VARCHAR(191) NOT NULL,
    `logPath` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `lastLogAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(64) NULL,
    `updatedBy` VARCHAR(64) NULL,

    INDEX `applications_serverId_idx`(`serverId`),
    INDEX `applications_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_config` (
    `id` VARCHAR(16) NOT NULL DEFAULT 'singleton',
    `displayColors` JSON NOT NULL,
    `alertChannelsDefault` JSON NOT NULL,
    `analyzerDefaults` JSON NOT NULL,
    `serviceCheckDefaults` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(64) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_configs` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `displayColors` JSON NOT NULL,
    `alertChannels` JSON NOT NULL,
    `quietHours` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(64) NULL,

    UNIQUE INDEX `app_configs_applicationId_key`(`applicationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `analyzer_rules` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `name` VARCHAR(190) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `params` JSON NOT NULL,
    `cooldown` VARCHAR(16) NOT NULL DEFAULT '15m',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(64) NULL,
    `updatedBy` VARCHAR(64) NULL,

    INDEX `analyzer_rules_applicationId_enabled_idx`(`applicationId`, `enabled`),
    INDEX `analyzer_rules_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `alert_events` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `ruleId` VARCHAR(191) NULL,
    `severity` VARCHAR(16) NOT NULL,
    `message` TEXT NOT NULL,
    `triggeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `lastNotifiedAt` DATETIME(3) NULL,
    `channelsNotified` JSON NOT NULL,

    INDEX `alert_events_applicationId_resolvedAt_idx`(`applicationId`, `resolvedAt`),
    INDEX `alert_events_ruleId_resolvedAt_idx`(`ruleId`, `resolvedAt`),
    INDEX `alert_events_triggeredAt_idx`(`triggeredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monitored_services` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(190) NOT NULL,
    `checkType` VARCHAR(32) NOT NULL DEFAULT 'systemd',
    `critical` BOOLEAN NOT NULL DEFAULT true,
    `checkInterval` INTEGER NOT NULL DEFAULT 30,
    `lastState` VARCHAR(16) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `monitored_services_applicationId_critical_idx`(`applicationId`, `critical`),
    UNIQUE INDEX `monitored_services_applicationId_name_key`(`applicationId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_status_events` (
    `id` VARCHAR(191) NOT NULL,
    `monitoredServiceId` VARCHAR(191) NOT NULL,
    `previousState` VARCHAR(16) NULL,
    `newState` VARCHAR(16) NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_status_events_monitoredServiceId_changedAt_idx`(`monitoredServiceId`, `changedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ingestion_agent_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `serverId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `label` VARCHAR(190) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ingestion_agent_tokens_tokenHash_key`(`tokenHash`),
    INDEX `ingestion_agent_tokens_applicationId_revokedAt_idx`(`applicationId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `log_entries` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `applicationType` VARCHAR(64) NOT NULL,
    `server` VARCHAR(255) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL,
    `level` VARCHAR(32) NOT NULL,
    `message` TEXT NOT NULL,
    `raw` TEXT NOT NULL,
    `metadata` JSON NULL,

    INDEX `log_entries_applicationId_timestamp_idx`(`applicationId`, `timestamp`),
    INDEX `log_entries_applicationId_level_timestamp_idx`(`applicationId`, `level`, `timestamp`),
    INDEX `log_entries_timestamp_idx`(`timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `applications` ADD CONSTRAINT `applications_serverId_fkey` FOREIGN KEY (`serverId`) REFERENCES `servers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_configs` ADD CONSTRAINT `app_configs_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `analyzer_rules` ADD CONSTRAINT `analyzer_rules_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_events` ADD CONSTRAINT `alert_events_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_events` ADD CONSTRAINT `alert_events_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `analyzer_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `monitored_services` ADD CONSTRAINT `monitored_services_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_status_events` ADD CONSTRAINT `service_status_events_monitoredServiceId_fkey` FOREIGN KEY (`monitoredServiceId`) REFERENCES `monitored_services`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ingestion_agent_tokens` ADD CONSTRAINT `ingestion_agent_tokens_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `log_entries` ADD CONSTRAINT `log_entries_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
